import type { ChangeStream } from 'mongodb';
import CustomerOrder from '../models/CustomerOrder';
import logger from '../config/logger';
import { emitOrderUpdated } from '../socket/orderSocket';

/**
 * Watches `customerorders` for customer-visible lifecycle fields and fans
 * `ORDER_UPDATED` to seller + customer socket rooms.
 *
 * Covers writes that never go through QC services (e.g. task-service updating
 * `assignmentStatus` / `executionPhase` directly in Mongo). Service-level
 * `emitOrderUpdated` calls may double-emit; clients invalidate/refetch, so that
 * is harmless.
 *
 * Requires a replica set (Atlas is one). Best-effort reopen with safe graduated backoff.
 */

const TRACKED_FIELD_PREFIXES = [
  'status',
  'fulfillmentStatus',
  'assignmentStatus',
  'executionPhase',
  'executionPhaseUpdatedAt',
  'partnerName',
  'partnerUid',
  'assignedTo',
  'assignedHelperName',
  'assignedAt',
  'cancelledAt',
  'completedAt',
] as const;

let stream: ChangeStream | null = null;
let stopped = false;
let isOpening = false;
let isClosingIntentional = false;
let reopenTimer: NodeJS.Timeout | null = null;
let stabilityTimer: NodeJS.Timeout | null = null;
let resumeToken: unknown = null;

// Safe graduated backoff: 5s -> 15s -> 30s -> 60s (max 60s)
const BACKOFF_SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000] as const;
const STABILITY_THRESHOLD_MS = 30_000;
let backoffIndex = 0;

function isNonReplicaSetError(err: unknown): boolean {
  const msg = (err as Error)?.message || '';
  const code = (err as { code?: number })?.code;
  return code === 40573 || msg.includes('ChangeStreamNotSupported') || msg.includes('replica set');
}

function updatedFieldsMatter(updatedFields: Record<string, unknown> | undefined): boolean {
  if (!updatedFields) return false;
  return Object.keys(updatedFields).some((key) =>
    TRACKED_FIELD_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)),
  );
}

async function closeStream(intentional = true): Promise<void> {
  if (stabilityTimer) {
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }
  const s = stream;
  stream = null;
  if (s) {
    isClosingIntentional = intentional;
    try {
      s.removeAllListeners();
      await Promise.race([
        s.close(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      /* already closed or gone */
    } finally {
      isClosingIntentional = false;
    }
  }
}

function scheduleReopen(reason: string): void {
  if (stopped) return;
  if (reopenTimer) {
    // Debounce: exactly one reconnect timer can be pending
    return;
  }

  if (stabilityTimer) {
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }

  const wait = BACKOFF_SCHEDULE_MS[Math.min(backoffIndex, BACKOFF_SCHEDULE_MS.length - 1)];
  backoffIndex = Math.min(backoffIndex + 1, BACKOFF_SCHEDULE_MS.length - 1);

  logger.warn('orderStatusWatcher: scheduling reconnect', {
    pid: process.pid,
    reason,
    delayMs: wait,
    nextBackoffMs: BACKOFF_SCHEDULE_MS[Math.min(backoffIndex, BACKOFF_SCHEDULE_MS.length - 1)],
  });

  reopenTimer = setTimeout(() => {
    reopenTimer = null;
    void open();
  }, wait);
  reopenTimer.unref();
}

function onStreamConnected(): void {
  logger.info('orderStatusWatcher: watching customerorders for status fields', { pid: process.pid });

  // Start stability timer: if stream stays healthy for 30 seconds, reset backoff
  if (stabilityTimer) {
    clearTimeout(stabilityTimer);
  }
  stabilityTimer = setTimeout(() => {
    stabilityTimer = null;
    if (backoffIndex > 0) {
      logger.info('orderStatusWatcher: stream connection is stable (30s+), resetting backoff', {
        pid: process.pid,
      });
      backoffIndex = 0;
    }
  }, STABILITY_THRESHOLD_MS);
  stabilityTimer.unref();
}

async function open(): Promise<void> {
  if (stopped || isOpening) return;
  if (stream) return; // Strict singleton: maximum 1 active Change Stream

  isOpening = true;
  try {
    if (reopenTimer) {
      clearTimeout(reopenTimer);
      reopenTimer = null;
    }

    const pipeline = [
      {
        $match: {
          operationType: { $in: ['update', 'replace'] },
        },
      },
    ];

    const newStream = CustomerOrder.watch(pipeline, {
      fullDocument: 'updateLookup',
      ...(resumeToken ? { resumeAfter: resumeToken } : {}),
    }) as unknown as ChangeStream;

    stream = newStream;
    onStreamConnected();

    newStream.on('change', (change: Record<string, unknown>) => {
      resumeToken = (change as { _id?: unknown })._id ?? resumeToken;
      const op = String((change as { operationType?: string }).operationType || '');
      if (op === 'update') {
        const updated = (change as { updateDescription?: { updatedFields?: Record<string, unknown> } })
          .updateDescription?.updatedFields;
        if (!updatedFieldsMatter(updated)) return;
      }

      const doc = (change as { fullDocument?: Record<string, unknown> }).fullDocument;
      if (!doc?._id || !doc.orderNumber) return;

      try {
        emitOrderUpdated({
          _id: doc._id as never,
          orderNumber: String(doc.orderNumber),
          sellerId: doc.sellerId as never,
          fulfillmentStatus: doc.fulfillmentStatus as never,
          status: doc.status as never,
          updatedAt: (doc.updatedAt as Date) ?? new Date(),
          userId: String(doc.userId || ''),
        });
      } catch (e) {
        logger.warn('orderStatusWatcher: emit failed', {
          pid: process.pid,
          orderId: String(doc._id),
          error: (e as Error)?.message,
        });
      }
    });

    newStream.on('error', (err: Error) => {
      if (isNonReplicaSetError(err)) {
        logger.error('orderStatusWatcher: Change streams require a MongoDB replica set. Stopping watcher.', {
          pid: process.pid,
          error: err.message,
        });
        stopped = true;
        void closeStream(true);
        return;
      }

      logger.warn('orderStatusWatcher: stream error', { pid: process.pid, error: err?.message });
      void closeStream(true); // intentional close so 'close' event does not double-schedule
      scheduleReopen('stream_error');
    });

    newStream.on('close', () => {
      if (!stopped && !isClosingIntentional) {
        logger.warn('orderStatusWatcher: stream closed unexpectedly', { pid: process.pid });
        void closeStream(true);
        scheduleReopen('stream_closed');
      }
    });
  } catch (err) {
    if (isNonReplicaSetError(err)) {
      logger.error('orderStatusWatcher: Change streams require a MongoDB replica set. Stopping watcher.', {
        pid: process.pid,
        error: (err as Error)?.message,
      });
      stopped = true;
      return;
    }

    logger.error('orderStatusWatcher: failed to open change stream', {
      pid: process.pid,
      error: (err as Error)?.message,
    });
    scheduleReopen('open_failed');
  } finally {
    isOpening = false;
  }
}

export function startOrderStatusWatcher(): void {
  stopped = false;
  backoffIndex = 0;
  void open();
}

export async function stopOrderStatusWatcher(): Promise<void> {
  stopped = true;
  if (reopenTimer) {
    clearTimeout(reopenTimer);
    reopenTimer = null;
  }
  if (stabilityTimer) {
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }
  await closeStream(true);
}
