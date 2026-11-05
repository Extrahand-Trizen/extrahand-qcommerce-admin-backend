import { Types } from 'mongoose';
import CustomerOrder from '../models/CustomerOrder';

/**
 * Track E — the shop's fulfilment quality, computed on read from the order
 * history via a single MongoDB $facet aggregation.
 */

const WINDOWS: Record<string, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
};

export interface SellerMetrics {
  window: string;
  orders: number;
  /** Orders the shopkeeper has decided on (accepted or rejected or timed out). */
  decided: number;
  accepted: number;
  rejected: number;
  timedOut: number;
  completed: number;
  /** accepted / decided, 0–1. */
  acceptanceRate: number;
  /** Average actual prep time (accept → ready), minutes. null if no data. */
  avgPrepMinutes: number | null;
  /** Average prep time the shopkeeper promised at accept, minutes. */
  avgPromisedMinutes: number | null;
  /** Orders marked ready after their deadline / orders marked ready, 0–1. */
  prepBreachRate: number;
  /** How many orders had "Add time" used at least once. */
  ordersExtended: number;
}

export async function getSellerMetrics(
  sellerId: string,
  windowKey = '7d',
): Promise<SellerMetrics> {
  const days = WINDOWS[windowKey] ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const baseMatch = {
    sellerId: new Types.ObjectId(sellerId),
    paymentStatus: 'PAID',
    createdAt: { $gte: since },
  };

  const [result] = await CustomerOrder.aggregate([
    { $match: baseMatch },
    {
      $facet: {
        total: [{ $count: 'n' }],
        accepted: [
          {
            $match: {
              fulfillmentStatus: { $in: ['ACCEPTED', 'PREPARING', 'READY', 'HANDED_OVER', 'COMPLETED'] },
            },
          },
          { $count: 'n' },
        ],
        completed: [
          { $match: { fulfillmentStatus: { $in: ['HANDED_OVER', 'COMPLETED'] } } },
          { $count: 'n' },
        ],
        rejected: [
          {
            $match: {
              fulfillmentStatus: 'REJECTED',
              rejectedReason: { $ne: 'TIMEOUT' },
            },
          },
          { $count: 'n' },
        ],
        timedOut: [
          {
            $match: {
              fulfillmentStatus: 'REJECTED',
              rejectedReason: 'TIMEOUT',
            },
          },
          { $count: 'n' },
        ],
        ordersExtended: [
          { $match: { prepMinutesAdded: { $gt: 0 } } },
          { $count: 'n' },
        ],
        prepStats: [
          {
            $match: {
              readyAt: { $exists: true, $ne: null },
              acceptedAt: { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: null,
              readyCount: { $sum: 1 },
              breached: { $sum: { $cond: ['$prepBreached', 1, 0] } },
              prepSumMs: {
                $sum: { $subtract: ['$readyAt', '$acceptedAt'] },
              },
              prepN: { $sum: 1 },
            },
          },
        ],
        promisedStats: [
          {
            $match: {
              readyAt: { $exists: true, $ne: null },
              acceptedAt: { $exists: true, $ne: null },
              prepMinutes: { $exists: true, $type: 'number' },
            },
          },
          {
            $group: {
              _id: null,
              promisedSum: { $sum: '$prepMinutes' },
              promisedN: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);

  const totalOrders: number = result?.total?.[0]?.n ?? 0;
  const accepted: number = result?.accepted?.[0]?.n ?? 0;
  const completed: number = result?.completed?.[0]?.n ?? 0;
  const rejected: number = result?.rejected?.[0]?.n ?? 0;
  const timedOut: number = result?.timedOut?.[0]?.n ?? 0;
  const ordersExtended: number = result?.ordersExtended?.[0]?.n ?? 0;

  const prepStats = result?.prepStats?.[0];
  const readyCount: number = prepStats?.readyCount ?? 0;
  const breached: number = prepStats?.breached ?? 0;
  const prepSumMs: number = prepStats?.prepSumMs ?? 0;
  const prepN: number = prepStats?.prepN ?? 0;

  const promisedStats = result?.promisedStats?.[0];
  const promisedSum: number = promisedStats?.promisedSum ?? 0;
  const promisedN: number = promisedStats?.promisedN ?? 0;

  const decided = accepted + rejected + timedOut;

  return {
    window: windowKey,
    orders: totalOrders,
    decided,
    accepted,
    rejected,
    timedOut,
    completed,
    acceptanceRate: decided ? accepted / decided : 0,
    avgPrepMinutes: prepN ? Math.round(prepSumMs / prepN / 60_000) : null,
    avgPromisedMinutes: promisedN ? Math.round(promisedSum / promisedN) : null,
    prepBreachRate: readyCount ? breached / readyCount : 0,
    ordersExtended,
  };
}
