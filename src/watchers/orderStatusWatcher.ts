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
 * Requires a replica set (Atlas is one). Best-effort reopen with backoff.
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
let backoffMs = 1_000;
const MAX_BACKOFF_MS = 60_000;
let resumeToken: unknown = null;

function updatedFieldsMatter(updatedFields: Record<string, unknown> | undefined): boolean {
  if (!updatedFields) return false;
  return Object.keys(updatedFields).some((key) =>
    TRACKED_FIELD_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)),
  );
}

function open(): void {
  if (stopped) return;

  const pipeline = [
    {
      $match: {
        operationType: { $in: ['update', 'replace'] },
      },
    },
  ];

  try {
    stream = CustomerOrder.watch(pipeline, {
      fullDocument: 'updateLookup',
      ...(resumeToken ? { resumeAfter: resumeToken } : {}),
    }) as unknown as ChangeStream;
  } catch (err) {
    logger.error('orderStatusWatcher: failed to open change stream', {
      error: (err as Error)?.message,
    });
    scheduleReopen();
    return;
  }

  backoffMs = 1_000;
  logger.info('orderStatusWatcher: watching customerorders for status fields');

  stream.on('change', (change: Record<string, unknown>) => {
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
        orderId: String(doc._id),
        error: (e as Error)?.message,
      });
    }
  });

  stream.on('error', (err: Error) => {
    logger.warn('orderStatusWatcher: stream error, reopening', { error: err?.message });
    void closeStream();
    scheduleReopen();
  });

  stream.on('close', () => {
    if (!stopped) scheduleReopen();
  });
}

function scheduleReopen(): void {
  if (stopped) return;
  const wait = backoffMs;
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  setTimeout(open, wait).unref();
}

async function closeStream(): Promise<void> {
  const s = stream;
  stream = null;
  if (s) {
    try {
      await s.close();
    } catch {
      /* already gone */
    }
  }
}

export function startOrderStatusWatcher(): void {
  stopped = false;
  open();
}

export async function stopOrderStatusWatcher(): Promise<void> {
  stopped = true;
  await closeStream();
}
