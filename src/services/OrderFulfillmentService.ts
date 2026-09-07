import CustomerOrder, {
  QC_REJECT_REASON,
  QcFulfillmentStatus,
  QcRejectReason,
} from '../models/CustomerOrder';
import { AppError } from '../utils/response';
import { QcOrderService } from './QcOrderService';
import { notifyCustomerOrderUpdate } from './QcOrderNotificationService';
import { OrderTimeoutService } from './OrderTimeoutService';
import { recordRejectionOrMiss } from './SellerFulfillmentHealthService';
import { issueOrderRefund } from './PaymentService';

export type FulfillmentAction =
  | 'accept'
  | 'reject'
  | 'start-preparing'
  | 'mark-ready'
  | 'mark-handed-over'
  /** Track E — bump the prep estimate without changing status. */
  | 'extend-prep';

export interface FulfillmentPayload {
  prepMinutes?: number;
  addMinutes?: number;
  reason?: string;
  note?: string;
  handoverCode?: string;
}

/**
 * The only legal fulfilment moves. Anything not in this table is rejected with a
 * 409 — the backend is the single source of truth for order state.
 */
const TRANSITIONS: Record<QcFulfillmentStatus, Partial<Record<FulfillmentAction, QcFulfillmentStatus>>> = {
  PENDING_ACCEPT: { accept: 'ACCEPTED', reject: 'REJECTED' },
  ACCEPTED: { 'start-preparing': 'PREPARING' },
  PREPARING: { 'mark-ready': 'READY' },
  READY: { 'mark-handed-over': 'HANDED_OVER' },
  HANDED_OVER: {},
  REJECTED: {},
  CANCELLED: {},
};

const ACTION_VERB: Record<FulfillmentAction, string> = {
  accept: 'accept',
  reject: 'reject',
  'start-preparing': 'start preparing',
  'mark-ready': 'mark ready',
  'mark-handed-over': 'hand over',
  'extend-prep': 'add time to',
};

const MAX_ADD_MINUTES = 120;

export class OrderFulfillmentService {
  /**
   * Apply a shopkeeper action to one order. Guards ownership, the payment gate,
   * and the transition table; records an event; notifies the customer; returns
   * the refreshed seller DTO.
   */
  static async transition(
    sellerId: string,
    orderId: string,
    action: FulfillmentAction,
    payload: FulfillmentPayload = {},
  ) {
    const order = await CustomerOrder.findOne({ _id: orderId, sellerId });
    if (!order) throw new AppError('Order not found', 404);

    if (order.paymentStatus !== 'PAID') {
      throw new AppError('This order has not been paid for yet', 409);
    }

    // Track B — if the accept window lapsed, auto-reject now and refuse the
    // action with a clear message rather than racing the sweep.
    if (await OrderTimeoutService.autoRejectIfLapsed(order)) {
      throw new AppError('This order timed out and was cancelled', 409);
    }

    const current: QcFulfillmentStatus = order.fulfillmentStatus ?? 'PENDING_ACCEPT';

    // Track E — "Add time" doesn't change status, so it sidesteps the table.
    if (action === 'extend-prep') {
      if (current !== 'ACCEPTED' && current !== 'PREPARING') {
        throw new AppError(
          `Can't add time to an order that is ${current.replace(/_/g, ' ').toLowerCase()}`,
          409,
        );
      }
      const addMinutes = Math.round(Number(payload.addMinutes));
      if (!Number.isFinite(addMinutes) || addMinutes < 1 || addMinutes > MAX_ADD_MINUTES) {
        throw new AppError(`addMinutes must be a number between 1 and ${MAX_ADD_MINUTES}`, 400);
      }
      order.prepMinutesAdded = (order.prepMinutesAdded ?? 0) + addMinutes;
      const base = order.acceptedAt?.getTime() ?? Date.now();
      order.readyBy = new Date(base + ((order.prepMinutes ?? 0) + order.prepMinutesAdded) * 60_000);
      order.fulfillmentEvents.push({
        action: 'PREP_EXTENDED',
        by: 'seller',
        at: new Date(),
        meta: { addMinutes, totalAdded: order.prepMinutesAdded },
      });
      await order.save();
      void notifyCustomerOrderUpdate({
        customerUserId: order.userId,
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        action: 'extend-prep',
        addMinutes,
      });
      return QcOrderService.getSellerOrder(sellerId, orderId);
    }

    const next = TRANSITIONS[current]?.[action];
    if (!next) {
      throw new AppError(
        `Can't ${ACTION_VERB[action]} an order that is ${current.replace(/_/g, ' ').toLowerCase()}`,
        409,
      );
    }

    const meta: Record<string, unknown> = {};

    if (action === 'accept') {
      const prepMinutes = Number(payload.prepMinutes);
      if (!Number.isFinite(prepMinutes) || prepMinutes < 1 || prepMinutes > 180) {
        throw new AppError('prepMinutes must be a number between 1 and 180', 400);
      }
      order.acceptedAt = new Date();
      order.prepMinutes = Math.round(prepMinutes);
      order.readyBy = new Date(Date.now() + Math.round(prepMinutes) * 60_000);
      meta.prepMinutes = order.prepMinutes;
    }

    if (action === 'reject') {
      const reason = String(payload.reason || '') as QcRejectReason;
      if (!QC_REJECT_REASON.includes(reason)) {
        throw new AppError(
          `reason must be one of: ${QC_REJECT_REASON.join(', ')}`,
          400,
        );
      }
      order.rejectedReason = reason;
      order.rejectedNote = payload.note?.trim() || undefined;
      meta.reason = reason;
      if (order.rejectedNote) meta.note = order.rejectedNote;
    }

    if (action === 'mark-handed-over') {
      const code = String(payload.handoverCode || '').trim();
      if (!order.handoverCode || code !== order.handoverCode) {
        throw new AppError('Incorrect handover code', 409);
      }
    }

    // Track E — start-preparing resets the pick checklist.
    if (action === 'start-preparing') {
      order.preparingStartedAt = new Date();
      order.items.forEach((it) => { it.preparationChecked = false; });
    }

    // Track E — every line must be checked off before the order can go READY,
    // and stamp the prep-time SLA outcome.
    if (action === 'mark-ready') {
      const unchecked = order.items.filter((it) => !it.preparationChecked).length;
      if (unchecked > 0) {
        throw new AppError(
          `Check every item before marking the order ready (${unchecked} left)`,
          409,
        );
      }
      const now = new Date();
      order.readyAt = now;
      order.prepBreached = order.readyBy ? now.getTime() > order.readyBy.getTime() : false;
      if (order.prepBreached) meta.prepBreached = true;
    }

    order.fulfillmentStatus = next;
    order.fulfillmentEvents.push({
      action,
      by: 'seller',
      at: new Date(),
      meta: Object.keys(meta).length ? meta : undefined,
    });
    await order.save();

    void notifyCustomerOrderUpdate({
      customerUserId: order.userId,
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      action,
      prepMinutes: order.prepMinutes,
    });

    if (action === 'reject') {
      // Refund the prepaid customer — the shop can't fulfil the order.
      void issueOrderRefund(order._id.toString(), 'REJECTED');
      // A manual reject counts toward the rejection cycle, same as a timeout.
      // (Timeouts are recorded in OrderTimeoutService.)
      if (order.sellerId) void recordRejectionOrMiss(order.sellerId, order._id);
    }

    return QcOrderService.getSellerOrder(sellerId, orderId);
  }

  /**
   * Track E — toggle one order line's "collected" checkbox while preparing.
   * Persisted so the checklist survives leaving and reopening the screen.
   */
  static async setItemPrepCheck(
    sellerId: string,
    orderId: string,
    itemIndex: number,
    checked: boolean,
  ) {
    const order = await CustomerOrder.findOne({ _id: orderId, sellerId });
    if (!order) throw new AppError('Order not found', 404);
    if (order.paymentStatus !== 'PAID') {
      throw new AppError('This order has not been paid for yet', 409);
    }
    if (order.fulfillmentStatus !== 'PREPARING') {
      throw new AppError('The pick checklist is only available while preparing the order', 409);
    }
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
      throw new AppError('Invalid item index', 400);
    }

    order.items[itemIndex].preparationChecked = Boolean(checked);
    order.markModified('items');
    await order.save();

    return QcOrderService.getSellerOrder(sellerId, orderId);
  }
}
