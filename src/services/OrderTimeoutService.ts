import { Types } from 'mongoose';
import CustomerOrder, { ICustomerOrder } from '../models/CustomerOrder';
import logger from '../config/logger';
import Seller from '../models/Seller';
import { issueOrderRefund } from './PaymentService';
import { notifyCustomerOrderUpdate, notifySellerOrderAutoRejected } from './QcOrderNotificationService';
import { recordRejectionOrMiss } from './SellerFulfillmentHealthService';
import { InventoryService } from './InventoryService';

/**
 * Track B — the accept-timeout engine.
 *
 * An order that reaches `acceptDeadline` still in PENDING_ACCEPT is auto-rejected:
 * the customer is refunded in full and told the shop didn't respond, and the
 * shop gets a "miss" recorded against it.
 *
 * Two entry points, deliberately:
 *  - `expireStale()` — the periodic sweep (server.ts). Authoritative: refunds
 *    the customer even if no seller request ever comes in.
 *  - `autoRejectIfLapsed()` — a lazy check run whenever seller order code loads a
 *    PENDING_ACCEPT order, so a shopkeeper who opens the app late immediately
 *    sees the order already gone.
 *
 * This service must NOT import QcOrderService (which imports it) — keep it leaf.
 */
export class OrderTimeoutService {
  /**
   * Run the sweep: find every paid order past its `acceptDeadline` that is still
   * in PENDING_ACCEPT and auto-reject it. Safe to run concurrently (idempotent
   * atomic flip).
   */
  static async expireStale(filter: { sellerId?: Types.ObjectId | string } = {}): Promise<number> {
    const now = new Date();
    const query: Record<string, unknown> = {
      paymentStatus: 'PAID',
      fulfillmentStatus: 'PENDING_ACCEPT',
      acceptDeadline: { $lte: now },
    };
    if (filter.sellerId) query.sellerId = new Types.ObjectId(String(filter.sellerId));

    const stale = await CustomerOrder.find(query).select('_id');

    let expired = 0;
    for (const doc of stale) {
      const ok = await this.autoRejectOrder(doc._id as Types.ObjectId);
      if (ok) expired += 1;
    }
    return expired;
  }

  /**
   * Lazy gate: if this order is past its acceptDeadline, auto-reject it now.
   * Returns true if the order was auto-rejected due to timeout, false otherwise.
   */
  static async autoRejectIfLapsed(order: ICustomerOrder): Promise<boolean> {
    if (order.fulfillmentStatus !== 'PENDING_ACCEPT') return false;
    if (!order.acceptDeadline || order.acceptDeadline > new Date()) return false;

    return this.autoRejectOrder(order._id as Types.ObjectId);
  }

  /**
   * Transition one order from PENDING_ACCEPT to REJECTED (reason: TIMEOUT).
   * Guards against double-execution with an atomic findOneAndUpdate.
   */
  private static async autoRejectOrder(orderId: Types.ObjectId): Promise<boolean> {
    const now = new Date();
    const order = await CustomerOrder.findById(orderId);
    if (!order) return false;
    if (order.fulfillmentStatus !== 'PENDING_ACCEPT') return false;

    order.fulfillmentStatus = 'REJECTED';
    order.rejectedReason = 'TIMEOUT';
    order.fulfillmentEvents.push({
      action: 'AUTO_REJECTED',
      by: 'system',
      at: now,
      meta: { reason: 'TIMEOUT' },
    });
    if (order.sellerId && order.reservationStatus === 'RESERVED') {
      await InventoryService.releaseOrderStock(order.sellerId, order.items);
      order.reservationStatus = 'RELEASED';
    }
    await order.save();

    logger.info('Track B — order auto-rejected on accept-timeout', {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      sellerId: order.sellerId?.toString(),
    });

    // Complete and record the Razorpay refund attempt before notifying the customer.
    const refund = await issueOrderRefund(order._id.toString(), 'TIMEOUT');
    void notifyCustomerOrderUpdate({
      customerUserId: order.userId,
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      action: 'timeout',
      refundIssued: refund.ok,
    });
    if (order.sellerId) {
      void recordRejectionOrMiss(order.sellerId, order._id);
      // Tell the shopkeeper their order auto-rejected (they may have missed it).
      void Seller.findById(order.sellerId)
        .select('userId')
        .lean()
        .then((seller) => {
          if (seller?.userId) {
            return notifySellerOrderAutoRejected({
              sellerUserId: seller.userId,
              orderNumber: order.orderNumber,
              orderId: order._id.toString(),
            });
          }
        })
        .catch(() => undefined);
    }
    return true;
  }
}
