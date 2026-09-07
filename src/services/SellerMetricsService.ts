import { Types } from 'mongoose';
import CustomerOrder from '../models/CustomerOrder';

/**
 * Track E — the shop's fulfilment quality, computed on read from the order
 * history. Volume is low, so a single scan + reduce is fine; move to a nightly
 * aggregate if it ever hurts.
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

  const orders = await CustomerOrder.find({
    sellerId: new Types.ObjectId(sellerId),
    paymentStatus: 'PAID',
    createdAt: { $gte: since },
  })
    .select('fulfillmentStatus rejectedReason acceptedAt readyAt prepMinutes prepBreached prepMinutesAdded')
    .lean();

  let accepted = 0;
  let rejected = 0;
  let timedOut = 0;
  let completed = 0;
  let readyCount = 0;
  let breached = 0;
  let ordersExtended = 0;
  let prepSum = 0;
  let prepN = 0;
  let promisedSum = 0;
  let promisedN = 0;

  const ACCEPTED_STATES = new Set(['ACCEPTED', 'PREPARING', 'READY', 'HANDED_OVER']);

  for (const o of orders) {
    const status = o.fulfillmentStatus;
    if (status && ACCEPTED_STATES.has(status)) accepted += 1;
    if (status === 'HANDED_OVER') completed += 1;
    if (status === 'REJECTED') {
      if (o.rejectedReason === 'TIMEOUT') timedOut += 1;
      else rejected += 1;
    }
    if ((o.prepMinutesAdded ?? 0) > 0) ordersExtended += 1;

    if (o.readyAt && o.acceptedAt) {
      readyCount += 1;
      if (o.prepBreached) breached += 1;
      prepSum += (o.readyAt.getTime() - o.acceptedAt.getTime()) / 60_000;
      prepN += 1;
      if (typeof o.prepMinutes === 'number') {
        promisedSum += o.prepMinutes;
        promisedN += 1;
      }
    }
  }

  const decided = accepted + rejected + timedOut;

  return {
    window: windowKey,
    orders: orders.length,
    decided,
    accepted,
    rejected,
    timedOut,
    completed,
    acceptanceRate: decided ? accepted / decided : 0,
    avgPrepMinutes: prepN ? Math.round(prepSum / prepN) : null,
    avgPromisedMinutes: promisedN ? Math.round(promisedSum / promisedN) : null,
    prepBreachRate: readyCount ? breached / readyCount : 0,
    ordersExtended,
  };
}
