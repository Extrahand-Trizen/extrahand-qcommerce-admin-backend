import CustomerOrder, {
  QC_REJECT_REASON,
  QcFulfillmentStatus,
  QcRejectReason,
} from '../models/CustomerOrder';
import { AppError } from '../utils/response';
import { QcOrderService } from './QcOrderService';
import { notifyCustomerOrderUpdate } from './QcOrderNotificationService';

export type FulfillmentAction =
  | 'accept'
  | 'reject'
  | 'start-preparing'
  | 'mark-ready'
  | 'mark-handed-over';

export interface FulfillmentPayload {
  prepMinutes?: number;
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
};

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

    const current: QcFulfillmentStatus = order.fulfillmentStatus ?? 'PENDING_ACCEPT';
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

    return QcOrderService.getSellerOrder(sellerId, orderId);
  }
}
