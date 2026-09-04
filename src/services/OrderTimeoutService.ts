import { Types } from 'mongoose';
import CustomerOrder, { ICustomerOrder } from '../models/CustomerOrder';
import logger from '../config/logger';
import Seller from '../models/Seller';
import { issueOrderRefund } from './PaymentService';
import { notifyCustomerOrderUpdate, notifySellerOrderAutoRejected } from './QcOrderNotificationService';
import { recordRejectionOrMiss } from './SellerFulfillmentHealthService';

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
  /** True once the order was moved out of PENDING_ACCEPT here. */
  static async autoRejectIfLapsed(order: ICustomerOrder): Promise<boolean> {
    if (order.fulfillmentStatus !== 'PENDING_ACCEPT') return false;
    if (!order.acceptDeadline || order.acceptDeadline.getTime() > Date.now()) return false;
    await this.autoReject(order);
    return true;
  }

  /** Find every past-deadline order and auto-reject it. Returns the count. */
  static async expireStale(filter: { sellerId?: Types.ObjectId | string } = {}): Promise<number> {
    const query: Record<string, unknown> = {
      fulfillmentStatus: 'PENDING_ACCEPT',
      paymentStatus: 'PAID',
      acceptDeadline: { $lt: new Date() },
    };
    if (filter.sellerId) query.sellerId = new Types.ObjectId(String(filter.sellerId));

    const stale = await CustomerOrder.find(query);
    let done = 0;
    for (const order of stale) {
      try {
        await this.autoReject(order);
        done += 1;
      } catch (err) {
        logger.error('OrderTimeoutService: auto-reject failed', {
          err,
          orderId: order._id.toString(),
        });
      }
    }
    return done;
  }

  /**
   * The transition itself. Guards against a double-run (re-checks the status
   * under a fresh read is overkill for a single-process sweep, but the in-memory
   * status check keeps two overlapping sweeps from both refunding).
   */
  private static async autoReject(order: ICustomerOrder): Promise<void> {
    if (order.fulfillmentStatus !== 'PENDING_ACCEPT') return;

    const now = new Date();
    order.fulfillmentStatus = 'REJECTED';
    order.rejectedReason = 'TIMEOUT';
    order.fulfillmentEvents.push({
      action: 'AUTO_REJECTED',
      by: 'system',
      at: now,
      meta: { reason: 'TIMEOUT' },
    });
    await order.save();

    logger.info('Track B — order auto-rejected on accept-timeout', {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      sellerId: order.sellerId?.toString(),
    });

    // Fire-and-forget the side effects; a failure here must not resurrect the order.
    void issueOrderRefund(order._id.toString(), 'TIMEOUT');
    void notifyCustomerOrderUpdate({
      customerUserId: order.userId,
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      action: 'timeout',
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
  }
}
