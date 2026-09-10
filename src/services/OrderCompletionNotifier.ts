import { Types } from 'mongoose';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import logger from '../config/logger';
import { emitOrderUpdated, emitOrderCompleted } from '../socket/orderSocket';
import { notifySellerOrderCompleted } from './QcOrderNotificationService';

/**
 * Tell the seller an order is COMPLETED — exactly once, no matter how the status
 * got there (the partner-complete endpoint, a direct DB edit, a script, the
 * lazy auto-settle). The "notified" flag is claimed atomically so the endpoint
 * and the change-stream watcher can both call this and only one wins.
 *
 * A no-op unless the order is currently `fulfillmentStatus: 'COMPLETED'` and has
 * not been announced yet.
 */
export async function notifyOrderCompletedOnce(
  orderId: Types.ObjectId | string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(orderId)) return false;

  // Atomic claim: only the first caller for this order gets the document back.
  const order = await CustomerOrder.findOneAndUpdate(
    {
      _id: orderId,
      fulfillmentStatus: 'COMPLETED',
      completionNotifiedAt: { $exists: false },
    },
    { $set: { completionNotifiedAt: new Date() } },
    { new: true },
  );
  if (!order) return false;

  emitOrderUpdated(order);
  emitOrderCompleted(order);

  if (order.sellerId) {
    try {
      const seller = await Seller.findById(order.sellerId).select('userId').lean();
      if (seller?.userId) {
        await notifySellerOrderCompleted({
          sellerUserId: seller.userId,
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          partnerName: order.partnerName ?? undefined,
        });
      }
    } catch (e) {
      logger.warn('notifyOrderCompletedOnce: seller notification failed', {
        orderId: String(order._id),
        error: (e as Error)?.message,
      });
    }
  }

  logger.info('order completion announced', {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
  });
  return true;
}
