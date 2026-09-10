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
let backoffMs = 1_000;
const MAX_BACKOFF_MS = 60_000;
let resumeToken: unknown = null;

function open(): void {
  if (stopped) return;

  const pipeline = [
    {
      $match: {
        operationType: { $in: ['update', 'replace', 'insert'] },
        'fullDocument.fulfillmentStatus': 'COMPLETED',
      },
    },
  ];

  try {
    stream = CustomerOrder.watch(pipeline, {
      fullDocument: 'updateLookup',
      ...(resumeToken ? { resumeAfter: resumeToken } : {}),
    }) as unknown as ChangeStream;
  } catch (err) {
    logger.error('orderCompletionWatcher: failed to open change stream', {
      error: (err as Error)?.message,
    });
    scheduleReopen();
    return;
  }

  backoffMs = 1_000;
  logger.info('orderCompletionWatcher: watching customerorders for COMPLETED');

  stream.on('change', (change: Record<string, unknown>) => {
    resumeToken = (change as { _id?: unknown })._id ?? resumeToken;
    const id =
      ((change as { documentKey?: { _id?: unknown } }).documentKey?._id as unknown) ??
      ((change as { fullDocument?: { _id?: unknown } }).fullDocument?._id as unknown);
    if (!id) return;
    void notifyOrderCompletedOnce(String(id)).catch((e) =>
      logger.warn('orderCompletionWatcher: announce failed', {
        orderId: String(id),
        error: (e as Error)?.message,
      }),
    );
  });

  stream.on('error', (err: Error) => {
    logger.warn('orderCompletionWatcher: stream error, reopening', { error: err?.message });
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

/** Start the watcher. Call once after the DB connection is up. */
export function startOrderCompletionWatcher(): void {
  stopped = false;
  open();
}

/** Stop the watcher (graceful shutdown / tests). */
export async function stopOrderCompletionWatcher(): Promise<void> {
  stopped = true;
  await closeStream();
}
