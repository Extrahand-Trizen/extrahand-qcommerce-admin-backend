import type { ChangeStream } from 'mongodb';
import CustomerOrder from '../models/CustomerOrder';
import logger from '../config/logger';
import { notifyOrderCompletedOnce } from '../services/OrderCompletionNotifier';

/**
 * Watches the `customerorders` collection and announces an order the moment its
 * `fulfillmentStatus` is COMPLETED — however that happened: the partner-complete
 * endpoint, a direct DB edit, a script, an ops tool. The endpoint also announces
 * inline; `notifyOrderCompletedOnce` de-dupes so the seller is told exactly once.
 *
 * Requires a replica set (Atlas is one). Best-effort: on any stream error it
 * logs and re-opens with backoff, resuming from the last token so nothing that
 * changed while it was down is missed.
 */

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

  logger.warn('orderCompletionWatcher: scheduling reconnect', {
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
  logger.info('orderCompletionWatcher: watching customerorders for COMPLETED', { pid: process.pid });

  // Start stability timer: if stream stays healthy for 30 seconds, reset backoff
  if (stabilityTimer) {
    clearTimeout(stabilityTimer);
  }
  stabilityTimer = setTimeout(() => {
    stabilityTimer = null;
    if (backoffIndex > 0) {
      logger.info('orderCompletionWatcher: stream connection is stable (30s+), resetting backoff', {
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
          operationType: { $in: ['update', 'replace', 'insert'] },
          'fullDocument.fulfillmentStatus': 'COMPLETED',
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
      const id =
        ((change as { documentKey?: { _id?: unknown } }).documentKey?._id as unknown) ??
        ((change as { fullDocument?: { _id?: unknown } }).fullDocument?._id as unknown);
      if (!id) return;
      void notifyOrderCompletedOnce(String(id)).catch((e) =>
        logger.warn('orderCompletionWatcher: announce failed', {
          pid: process.pid,
          orderId: String(id),
          error: (e as Error)?.message,
        }),
      );
    });

    newStream.on('error', (err: Error) => {
      if (isNonReplicaSetError(err)) {
        logger.error('orderCompletionWatcher: Change streams require a MongoDB replica set. Stopping watcher.', {
          pid: process.pid,
          error: err.message,
        });
        stopped = true;
        void closeStream(true);
        return;
      }

      logger.warn('orderCompletionWatcher: stream error', { pid: process.pid, error: err?.message });
      void closeStream(true); // intentional close so 'close' event does not double-schedule
      scheduleReopen('stream_error');
    });

    newStream.on('close', () => {
      if (!stopped && !isClosingIntentional) {
        logger.warn('orderCompletionWatcher: stream closed unexpectedly', { pid: process.pid });
        void closeStream(true);
        scheduleReopen('stream_closed');
      }
    });
  } catch (err) {
    if (isNonReplicaSetError(err)) {
      logger.error('orderCompletionWatcher: Change streams require a MongoDB replica set. Stopping watcher.', {
        pid: process.pid,
        error: (err as Error)?.message,
      });
      stopped = true;
      return;
    }

    logger.error('orderCompletionWatcher: failed to open change stream', {
      pid: process.pid,
      error: (err as Error)?.message,
    });
    scheduleReopen('open_failed');
  } finally {
    isOpening = false;
  }
}

/** Start the watcher. Call once after the DB connection is up. */
export function startOrderCompletionWatcher(): void {
  stopped = false;
  backoffIndex = 0;
  void open();
}

/** Stop the watcher (graceful shutdown / tests). */
export async function stopOrderCompletionWatcher(): Promise<void> {
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
