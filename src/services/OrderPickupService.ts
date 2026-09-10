import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose, { ClientSession, Types } from 'mongoose';
import CustomerOrder, { ICustomerOrder } from '../models/CustomerOrder';
import OrderPickupQR, { PickupQrRevokeReason } from '../models/OrderPickupQR';
import { env } from '../config/env';
import logger from '../config/logger';
import { AppError } from '../utils/response';
import { notifyCustomerOrderUpdate, notifyPartnerPickedUpOrder } from './QcOrderNotificationService';
import { emitOrderUpdated } from '../socket/orderSocket';
import Seller from '../models/Seller';

export const QR_PREFIX = 'ORDER_PICKUP:';

function tokenFingerprint(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

interface PickupJwtPayload {
  purpose: 'ORDER_PICKUP';
  orderId: string;
  storeId: string;
  jti: string;
  iat: number;
}

interface PartnerIdentity {
  uid: string;
  name?: string;
  phone?: string;
}

function pickupSecret(): string {
  const secret = env.PICKUP_QR_SECRET?.trim();
  if (!secret) {
    // Fail loud — the feature cannot work without it, and a silent fallback would
    // mint unverifiable QRs.
    throw new AppError(
      'Pickup QR is not configured on the server (PICKUP_QR_SECRET missing)',
      500,
      undefined,
      'PICKUP_QR_NOT_CONFIGURED',
    );
  }
  return secret;
}

function transactionsUnsupported(err: unknown): boolean {
  return /Transaction numbers are only allowed|replica set|does not support transactions|IllegalOperation/i.test(
    String((err as Error)?.message || ''),
  );
}

export class OrderPickupService {
  /**
   * Mint a fresh Order Pickup QR for an order. Revokes any existing ACTIVE QR
   * first (an old screenshot is now dead). Call right after the order goes READY.
   */
  static async generateForOrder(
    order: Pick<ICustomerOrder, '_id' | 'sellerId'>,
    session?: ClientSession,
  ): Promise<{ jti: string; token: string; qrString: string }> {
    const secret = pickupSecret();
    const now = new Date();
    const orderId = String(order._id);
    const storeId = String(order.sellerId);

    await OrderPickupQR.updateMany(
      { orderId: order._id, status: 'ACTIVE' },
      {
        $set: { status: 'REVOKED', revokedAt: now, revokedReason: 'REPREPARED' as PickupQrRevokeReason },
        $push: { events: { type: 'REVOKED', at: now, actorType: 'system', meta: { reason: 'REPREPARED' } } },
      },
      session ? { session } : {},
    );

    const jti = `qr_${crypto.randomBytes(12).toString('hex')}`;
    const payload: PickupJwtPayload = {
      purpose: 'ORDER_PICKUP',
      orderId,
      storeId,
      jti,
      iat: Math.floor(now.getTime() / 1000),
    };
    // No expiresIn — validity is lifecycle-driven (QR ACTIVE + order READY).
    const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

    await OrderPickupQR.create(
      [
        {
          jti,
          orderId: order._id,
          sellerId: order.sellerId,
          purpose: 'ORDER_PICKUP',
          status: 'ACTIVE',
          token,
          events: [{ type: 'GENERATED', at: now, actorType: 'system' }],
        },
      ],
      session ? { session } : {},
    );

    logger.info('[PickupQR] Generated seller pickup QR', {
      orderId,
      storeId,
      jti,
      tokenFingerprint: tokenFingerprint(token),
    });

    return { jti, token, qrString: `${QR_PREFIX}${token}` };
  }

  /** Revoke the ACTIVE QR for an order (reprepare / cancel / store delete). No-op if none. */
  static async revokeForOrder(
    orderId: Types.ObjectId | string,
    reason: PickupQrRevokeReason,
    session?: ClientSession,
  ): Promise<void> {
    const now = new Date();
    await OrderPickupQR.updateMany(
      { orderId, status: 'ACTIVE' },
      {
        $set: { status: 'REVOKED', revokedAt: now, revokedReason: reason },
        $push: { events: { type: 'REVOKED', at: now, actorType: 'system', meta: { reason } } },
      },
      session ? { session } : {},
    );
  }

  /** The QR the seller app shows on the order screen. Null if the order has no live QR. */
  static async getForOrder(orderId: Types.ObjectId | string, sellerId: Types.ObjectId | string) {
    const qr = await OrderPickupQR.findOne({ orderId, sellerId, status: 'ACTIVE' })
      .sort({ createdAt: -1 })
      .lean();
    if (!qr) return null;
    return {
      jti: qr.jti,
      token: qr.token,
      qrString: `${QR_PREFIX}${qr.token}`,
      status: qr.status,
      createdAt: qr.createdAt,
    };
  }

  /**
   * Like `getForOrder`, but self-heals: if the order is READY yet has no ACTIVE
   * QR — it reached READY before this feature shipped, or via a path that
   * bypassed `mark-ready` — mint one now. Returns null only when the order
   * genuinely shouldn't have a QR (not READY) or minting isn't configured.
   */
  static async getOrMintForOrder(
    order: Pick<ICustomerOrder, '_id' | 'sellerId' | 'fulfillmentStatus'>,
  ) {
    if (!order._id || !order.sellerId) return null;
    const existing = await this.getForOrder(order._id, order.sellerId);
    if (existing) return existing;
    if (order.fulfillmentStatus !== 'READY') return null;
    try {
      const minted = await this.generateForOrder(order);
      logger.warn('[PickupQR] Lazily minted missing QR for a READY order', {
        orderId: String(order._id),
        jti: minted.jti,
      });
      return {
        jti: minted.jti,
        token: minted.token,
        qrString: minted.qrString,
        status: 'ACTIVE' as const,
        createdAt: new Date(),
      };
    } catch (e) {
      logger.error('[PickupQR] Lazy mint failed', {
        orderId: String(order._id),
        error: (e as Error)?.message,
      });
      return null;
    }
  }

  private static fail(code: string, message: string, status: number): never {
    throw new AppError(message, status, undefined, code);
  }

  private static async recordScanFail(jti: string | undefined, partner: PartnerIdentity, code: string) {
    if (!jti) return;
    try {
      await OrderPickupQR.updateOne(
        { jti },
        {
          $push: {
            events: {
              type: 'SCAN_FAIL',
              at: new Date(),
              actorType: 'partner',
              actorId: partner.uid,
              meta: { code },
            },
          },
        },
      );
    } catch {
      /* best-effort audit trail */
    }
  }

  /**
   * The one endpoint the mobile app calls. Verifies a scanned QR string and, on
   * success, atomically flips the order READY → HANDED_OVER and burns the QR.
   */
  static async verifyAndCompletePickup(
    partner: PartnerIdentity,
    rawQr: string,
    expectedOrderId?: string,
  ) {
    const secret = pickupSecret();

    // 1 — strip prefix + verify signature
    const trimmed = String(rawQr || '').trim();
    const token = trimmed.startsWith(QR_PREFIX) ? trimmed.slice(QR_PREFIX.length) : trimmed;
    logger.info('[PickupQR] Verification started', {
      partnerUid: partner.uid,
      expectedOrderId: expectedOrderId || null,
      rawLength: trimmed.length,
      hasPrefix: trimmed.startsWith(QR_PREFIX),
      tokenLength: token.length,
      tokenFingerprint: token ? tokenFingerprint(token) : null,
    });
    let payload: PickupJwtPayload;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as PickupJwtPayload;
    } catch (error: any) {
      const decoded = jwt.decode(token) as Partial<PickupJwtPayload> | null;
      const storedQr = decoded?.jti
        ? await OrderPickupQR.findOne({ jti: decoded.jti }).select('jti orderId sellerId status token').lean()
        : null;
      logger.warn('[PickupQR] JWT verification failed', {
        partnerUid: partner.uid,
        tokenLength: token.length,
        tokenFingerprint: token ? tokenFingerprint(token) : null,
        errorName: error?.name || 'UnknownError',
        errorMessage: error?.message || 'Unknown verification error',
        decodedJti: decoded?.jti || null,
        decodedOrderId: decoded?.orderId || null,
        storedQrFound: Boolean(storedQr),
        storedQrActive: storedQr?.status === 'ACTIVE',
        scannedTokenMatchesStored: Boolean(storedQr && storedQr.token === token),
      });
      this.fail('INVALID_QR', 'QR code is invalid or tampered.', 400);
    }

    logger.info('[PickupQR] JWT verified', {
      partnerUid: partner.uid,
      jti: payload.jti,
      orderId: payload.orderId,
      storeId: payload.storeId,
      purpose: payload.purpose,
    });

    // 2 — purpose
    if (payload.purpose !== 'ORDER_PICKUP') {
      await this.recordScanFail(payload.jti, partner, 'INVALID_QR_PURPOSE');
      this.fail('INVALID_QR_PURPOSE', 'This QR cannot be used for order pickup.', 400);
    }

    // 3 — QR row + order exist
    const qr = await OrderPickupQR.findOne({ jti: payload.jti });
    if (!qr) {
      logger.warn('[PickupQR] JWT valid but no QR record found', { jti: payload.jti, orderId: payload.orderId });
      this.fail('INVALID_QR', 'QR code is invalid or tampered.', 404);
    }

    if (!Types.ObjectId.isValid(payload.orderId)) {
      await this.recordScanFail(payload.jti, partner, 'ORDER_NOT_FOUND');
      this.fail('ORDER_NOT_FOUND', 'Order does not exist.', 404);
    }
    const order = await CustomerOrder.findById(payload.orderId);
    if (!order) {
      logger.warn('[PickupQR] QR points to missing order', { jti: payload.jti, orderId: payload.orderId });
      await this.recordScanFail(payload.jti, partner, 'ORDER_NOT_FOUND');
      this.fail('ORDER_NOT_FOUND', 'Order does not exist.', 404);
    }

    if (
      expectedOrderId &&
      String(order._id) !== expectedOrderId &&
      String(order.orderNumber) !== expectedOrderId.replace(/^#/, '')
    ) {
      logger.warn('[PickupQR] Order mismatch', {
        jti: payload.jti,
        qrOrderId: String(order._id),
        qrOrderNumber: order.orderNumber,
        expectedOrderId: expectedOrderId || null,
      });
      await this.recordScanFail(payload.jti, partner, 'ORDER_MISMATCH');
      this.fail('ORDER_MISMATCH', 'This QR code does not match the current order.', 409);
    }

    // 4 — store match (QR ↔ order ↔ token claim)
    if (
      String(qr.sellerId) !== String(order.sellerId) ||
      String(order.sellerId) !== String(payload.storeId)
    ) {
      logger.warn('[PickupQR] Store mismatch', {
        jti: payload.jti,
        qrSellerId: String(qr.sellerId),
        orderSellerId: String(order.sellerId),
        tokenStoreId: payload.storeId,
      });
      await this.recordScanFail(payload.jti, partner, 'STORE_MISMATCH');
      this.fail('STORE_MISMATCH', 'This QR does not belong to this order/store.', 409);
    }

    // 5 — QR state first: a USED / REVOKED QR gives the partner the precise
    //     reason (someone already picked it up / the order was cancelled or
    //     re-prepared) rather than the vaguer "order not ready".
    if (qr.status === 'USED') {
      await this.recordScanFail(payload.jti, partner, 'QR_ALREADY_USED');
      this.fail('QR_ALREADY_USED', 'This pickup QR has already been used.', 409);
    }
    if (qr.status === 'REVOKED') {
      await this.recordScanFail(payload.jti, partner, 'QR_REVOKED');
      this.fail('QR_REVOKED', 'This pickup QR is no longer valid.', 409);
    }

    // 6 — order state (QR is ACTIVE at this point)
    const parentStatus = String(order.status || '').toUpperCase();
    if (['CANCELLED', 'FAILED'].includes(parentStatus)) {
      await this.recordScanFail(payload.jti, partner, 'ORDER_CANCELLED');
      this.fail('ORDER_CANCELLED', 'This order has been cancelled.', 409);
    }
    if (order.fulfillmentStatus !== 'READY') {
      await this.recordScanFail(payload.jti, partner, 'ORDER_NOT_READY');
      this.fail('ORDER_NOT_READY', 'This order is not ready for pickup.', 409);
    }

    // 7 — assignment (claim-on-scan today; hard check once a real dispatch exists)
    if (order.partnerUid && String(order.partnerUid) !== partner.uid) {
      await this.recordScanFail(payload.jti, partner, 'PICKUP_NOT_AUTHORIZED');
      this.fail(
        'PICKUP_NOT_AUTHORIZED',
        'This order is assigned to another delivery partner.',
        403,
      );
    }

    // 8 — atomic completion
    const handedOver = await this.completeAtomically(payload, order, partner);

    // Real-time: the seller app drops the order into the Handover tab without a poll.
    emitOrderUpdated(handedOver);

    const shopName = String(order.shopName || '').trim() || 'the store';
    // best-effort, non-blocking notifications
    void notifyCustomerOrderUpdate({
      customerUserId: order.userId,
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      action: 'mark-handed-over',
    });
    void Seller.findById(order.sellerId)
      .select('userId')
      .lean()
      .then((seller) => {
        if (seller?.userId) {
          return notifyPartnerPickedUpOrder({
            sellerUserId: seller.userId,
            orderId: String(order._id),
            orderNumber: order.orderNumber,
            partnerName: partner.name,
          });
        }
      })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Order pickup confirmed',
      orderId: String(order._id),
      storeId: String(order.sellerId),
      orderNumber: order.orderNumber,
      shopName,
      status: 'HANDED_OVER' as const,
    };
  }

  private static async completeAtomically(
    payload: PickupJwtPayload,
    order: ICustomerOrder,
    partner: PartnerIdentity,
  ): Promise<ICustomerOrder> {
    const now = new Date();

    const run = async (session?: ClientSession): Promise<ICustomerOrder> => {
      const opts = session ? { session, new: true } : { new: true };

      const burned = await OrderPickupQR.findOneAndUpdate(
        { jti: payload.jti, status: 'ACTIVE' },
        {
          $set: {
            status: 'USED',
            usedAt: now,
            usedByPartnerId: partner.uid,
            usedByPartnerName: partner.name,
          },
          $push: {
            events: { type: 'SCAN_OK', at: now, actorType: 'partner', actorId: partner.uid },
          },
        },
        opts,
      );
      if (!burned) {
        const fresh = await OrderPickupQR.findOne({ jti: payload.jti }).lean();
        if (fresh?.status === 'REVOKED') {
          this.fail('QR_REVOKED', 'This pickup QR is no longer valid.', 409);
        }
        this.fail('QR_ALREADY_USED', 'This pickup QR has already been used.', 409);
      }

      const updatedOrder = await CustomerOrder.findOneAndUpdate(
        {
          _id: order._id,
          sellerId: order.sellerId,
          fulfillmentStatus: 'READY',
          status: { $nin: ['CANCELLED', 'FAILED'] },
        },
        {
          $set: {
            fulfillmentStatus: 'HANDED_OVER',
            executionPhase: 'on_the_way',
            onTheWayAt: now,
            executionPhaseUpdatedAt: now,
            partnerUid: partner.uid,
            partnerAcceptedAt: now,
            partnerName: partner.name ?? null,
            partnerPhone: partner.phone ?? null,
            ...(order.status === 'PAID' ? { status: 'CONFIRMED' } : {}),
          },
          $push: {
            fulfillmentEvents: {
              action: 'PICKED_UP',
              by: 'system',
              at: now,
              meta: { partnerUid: partner.uid, partnerName: partner.name, jti: payload.jti },
            },
          },
        },
        opts,
      );
      if (!updatedOrder) {
        this.fail('ORDER_NOT_READY', 'This order is not ready for pickup.', 409);
      }
      return updatedOrder;
    };

    let session: ClientSession | null = null;
    let result: ICustomerOrder | null = null;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        result = await run(session as ClientSession);
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (!transactionsUnsupported(err)) throw err;
      logger.warn('verifyAndCompletePickup: transactions unsupported, sequential fallback');
      result = await run();
    } finally {
      if (session) await session.endSession();
    }
    if (!result) this.fail('ORDER_NOT_READY', 'This order is not ready for pickup.', 409);
    return result;
  }
}
