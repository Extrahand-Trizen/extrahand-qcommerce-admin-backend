import { Types } from 'mongoose';
import SellerStoreSettings from '../models/SellerStoreSettings';
import Seller from '../models/Seller';
import logger from '../config/logger';
import { REJECTION_CYCLE_THRESHOLD, PAUSE_DURATION_MINUTES } from '../config/orderFulfillment';
import { istDayString } from '../utils/istDay';
import { notifySellerShopAutoPaused, notifySellerShopReopened } from './QcOrderNotificationService';

const PAUSE_REASON = 'Multiple orders were rejected or missed';

/**
 * Track B — rejection-cycle bookkeeping.
 *
 * Every rejected or accept-timed-out order is counted against the shop. The
 * counts live on the seller's SellerStoreSettings row and follow two clocks:
 *
 *  - `dailyRejectedCount`  — total for the current IST calendar day. Purely
 *    informational; it only exists to keep yesterday's rejections out of today.
 *  - `rejectionCycleCount` — the current cycle. Hitting REJECTION_CYCLE_THRESHOLD
 *    pauses NEW orders for PAUSE_DURATION_MINUTES; when that pause expires the
 *    shop reopens itself and this counter goes back to 0, starting a fresh cycle.
 *
 * Both reset to 0 at IST midnight (`rolloverRejectionDayIfNeeded`, also applied
 * lazily on every settings read + checkout).
 *
 * Existing accepted / preparing / ready orders are never touched by any of this
 * — only new checkouts are blocked while paused (QcOrderService.checkout).
 */

/**
 * Reset the daily + cycle counters if the stored `rejectionDay` is not today
 * (IST). Cheap no-op when already current. Safe to call on any read path.
 */
export async function rolloverRejectionDayIfNeeded(
  sellerId: Types.ObjectId | string,
): Promise<void> {
  const today = istDayString();
  await SellerStoreSettings.updateOne(
    { sellerId: new Types.ObjectId(String(sellerId)), rejectionDay: { $ne: today } },
    {
      $set: {
        rejectionDay: today,
        dailyRejectedCount: 0,
        rejectionCycleCount: 0,
      },
      $unset: { rejectionCycleStartedAt: 1 },
    },
  ).catch((err) => logger.error('rolloverRejectionDayIfNeeded failed', { err, sellerId: String(sellerId) }));
}

/**
 * Record one rejected / missed order against a shop and auto-pause it if this
 * pushes the current cycle to the threshold.
 *
 * The counter bump is a single atomic aggregation-pipeline update so overlapping
 * calls (e.g. the sweep auto-rejecting several stale orders at once) can't lose
 * an increment. The pause flip is separately guarded so exactly one caller flips
 * the shop and sends the notification.
 */
export async function recordRejectionOrMiss(
  sellerId: Types.ObjectId | string,
  _orderId?: Types.ObjectId | string,
): Promise<void> {
  const sid = new Types.ObjectId(String(sellerId));
  const today = istDayString();
  const now = new Date();

  try {
    // 1. Atomic counter bump + midnight rollover in one stage. Within a pipeline
    //    $set every expression sees the pre-update document, so `$rejectionDay`
    //    below is still the OLD value while we also overwrite it.
    await SellerStoreSettings.updateOne(
      { sellerId: sid },
      [
        {
          $set: {
            storeStatus: { $ifNull: ['$storeStatus', 'OPEN'] },
            statusMode: { $ifNull: ['$statusMode', 'MANUAL'] },
            rejectionDay: today,
            dailyRejectedCount: {
              $add: [
                { $cond: [{ $eq: ['$rejectionDay', today] }, { $ifNull: ['$dailyRejectedCount', 0] }, 0] },
                1,
              ],
            },
            rejectionCycleCount: {
              $cond: [
                // While already paused, don't advance the cycle — the pause is
                // running; the cycle resets to 0 when it expires.
                { $ifNull: ['$autoPausedAt', false] },
                { $ifNull: ['$rejectionCycleCount', 0] },
                {
                  $add: [
                    { $cond: [{ $eq: ['$rejectionDay', today] }, { $ifNull: ['$rejectionCycleCount', 0] }, 0] },
                    1,
                  ],
                },
              ],
            },
            rejectionCycleStartedAt: {
              $cond: [
                {
                  $and: [
                    { $not: [{ $ifNull: ['$autoPausedAt', false] }] },
                    {
                      $or: [
                        { $ne: ['$rejectionDay', today] },
                        { $eq: [{ $ifNull: ['$rejectionCycleCount', 0] }, 0] },
                      ],
                    },
                  ],
                },
                now,
                { $ifNull: ['$rejectionCycleStartedAt', now] },
              ],
            },
          },
        },
      ],
      { upsert: true },
    ).catch((err: { code?: number }) => {
      if (err?.code !== 11000) throw err;
      return undefined;
    });

    // 2. Threshold check → guarded pause flip.
    const settings = await SellerStoreSettings.findOne({ sellerId: sid })
      .select('rejectionCycleCount autoPausedAt')
      .lean();
    const cycle = settings?.rejectionCycleCount ?? 0;
    if (settings?.autoPausedAt || cycle < REJECTION_CYCLE_THRESHOLD) return;

    const pauseUntil = new Date(Date.now() + PAUSE_DURATION_MINUTES * 60 * 1000);
    const flipped = await SellerStoreSettings.findOneAndUpdate(
      { sellerId: sid, autoPausedAt: { $exists: false } },
      {
        $set: {
          storeStatus: 'CLOSED',
          statusMode: 'MANUAL',
          autoPausedAt: new Date(),
          pauseUntil,
          pauseReason: PAUSE_REASON,
        },
      },
      { new: true },
    );
    if (!flipped) return;

    logger.warn('Track B — shop auto-paused: rejection cycle threshold reached', {
      sellerId: String(sellerId),
      rejections: cycle,
      pauseUntil,
    });
    const seller = await Seller.findById(sid).select('userId').lean();
    if (seller?.userId) {
      void notifySellerShopAutoPaused({ sellerUserId: seller.userId, rejections: cycle, pauseUntil });
    }
  } catch (err) {
    logger.error('recordRejectionOrMiss failed', { err, sellerId: String(sellerId) });
  }
}

/**
 * Reopen every shop whose auto-pause has expired. Called by the periodic sweep
 * AND lazily whenever a shop's settings are read, so the reopen is instant.
 * Reopening starts a fresh rejection cycle (`rejectionCycleCount` → 0) but keeps
 * `dailyRejectedCount` (only midnight clears that). Returns the number reopened.
 */
export async function reopenExpiredPauses(
  filter: { sellerId?: Types.ObjectId | string } = {},
): Promise<number> {
  const now = new Date();
  const query: Record<string, unknown> = {
    autoPausedAt: { $exists: true },
    pauseUntil: { $lte: now },
  };
  if (filter.sellerId) query.sellerId = new Types.ObjectId(String(filter.sellerId));

  const due = await SellerStoreSettings.find(query).select('sellerId').lean();
  let count = 0;
  for (const row of due) {
    const reopened = await SellerStoreSettings.findOneAndUpdate(
      { _id: (row as { _id: Types.ObjectId })._id, autoPausedAt: { $exists: true }, pauseUntil: { $lte: now } },
      {
        $set: { storeStatus: 'OPEN', statusMode: 'MANUAL', rejectionCycleCount: 0 },
        $unset: { autoPausedAt: 1, pauseUntil: 1, pauseReason: 1, rejectionCycleStartedAt: 1 },
      },
      { new: true },
    );
    if (!reopened) continue;
    count += 1;
    // A pause that straddled IST midnight — clear the stale daily count too.
    void rolloverRejectionDayIfNeeded(row.sellerId as Types.ObjectId);
    logger.info('Track B — shop auto-reopened after pause expired', { sellerId: String(row.sellerId) });
    const seller = await Seller.findById(row.sellerId).select('userId').lean();
    if (seller?.userId) void notifySellerShopReopened({ sellerUserId: seller.userId });
  }
  return count;
}
