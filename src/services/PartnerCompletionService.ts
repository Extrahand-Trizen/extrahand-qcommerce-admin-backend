import { Types } from 'mongoose';
import CustomerOrder from '../models/CustomerOrder';
import { AppError } from '../utils/response';
import { notifyOrderCompletedOnce } from './OrderCompletionNotifier';
import { formatOrder } from './QcOrderService';

interface PartnerIdentity {
  uid: string;
  name?: string;
  phone?: string;
}

export class PartnerCompletionService {
  /**
   * The delivery partner marks a picked-up order delivered.
   *
   * Guards (backend is the source of truth — nothing here is taken on trust from
   * the client except the verified partner identity from `requirePartner`):
   *  - the order exists
   *  - `order.partnerUid` === this partner (set when they scanned the pickup QR —
   *    claim-on-scan, so only the partner who collected the order can complete it)
   *  - the order is still `HANDED_OVER`
   *
   * Effect (atomic, conditional update): `fulfillmentStatus HANDED_OVER → COMPLETED`,
   * parent `status → DELIVERED`, `completedAt` stamped, a `COMPLETED` fulfilment
   * event pushed. Then the seller's store room gets `ORDER_UPDATED` + `ORDER_COMPLETED`
   * and the shopkeeper is notified.
   */
  static async completeOrder(partner: PartnerIdentity, orderId: string) {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new AppError('Order not found', 404, undefined, 'ORDER_NOT_FOUND');
    }

    const existing = await CustomerOrder.findById(orderId)
      .select('partnerUid fulfillmentStatus')
      .lean();
    if (!existing) {
      throw new AppError('Order not found', 404, undefined, 'ORDER_NOT_FOUND');
    }
    if (!existing.partnerUid || String(existing.partnerUid) !== partner.uid) {
      throw new AppError(
        'This order is assigned to another delivery partner',
        403,
        undefined,
        'NOT_ASSIGNED',
      );
    }
    if (existing.fulfillmentStatus === 'COMPLETED') {
      const done = await CustomerOrder.findById(orderId).lean();
      return { order: formatOrder(done as never, { forPartner: true }), alreadyCompleted: true };
    }
    if (existing.fulfillmentStatus !== 'HANDED_OVER') {
      const human = String(existing.fulfillmentStatus || 'not picked up')
        .toLowerCase()
        .replace(/_/g, ' ');
      throw new AppError(`Can't complete an order that is ${human}`, 409, undefined, 'INVALID_STATUS');
    }

    const now = new Date();
    const order = await CustomerOrder.findOneAndUpdate(
      { _id: orderId, partnerUid: partner.uid, fulfillmentStatus: 'HANDED_OVER' },
      {
        $set: {
          fulfillmentStatus: 'COMPLETED',
          completedAt: now,
          status: 'DELIVERED',
          ...(partner.name ? { partnerName: partner.name } : {}),
          ...(partner.phone ? { partnerPhone: partner.phone } : {}),
        },
        $push: {
          fulfillmentEvents: {
            action: 'COMPLETED',
            // `by` enum is seller|system|customer — the partner acts through the
            // API, same as the QR-scan PICKED_UP event; partner is in `meta`.
            by: 'system',
            at: now,
            meta: { partnerUid: partner.uid, partnerName: partner.name },
          },
        },
      },
      { new: true },
    );
    if (!order) {
      // Lost a race with a concurrent complete / cancel.
      throw new AppError(
        'This order is no longer available to complete',
        409,
        undefined,
        'INVALID_STATUS',
      );
    }

    // Real-time + notification — the single announce path, shared with the
    // DB change-stream watcher and guarded so the seller is told exactly once.
    await notifyOrderCompletedOnce(order._id);

    return { order: formatOrder(order as never, { forPartner: true }), alreadyCompleted: false };
  }
}
