import { Router, Response, NextFunction } from 'express';
import { requirePartner, PartnerRequest } from '../middleware/partnerAuth';
import { OrderPickupService } from '../services/OrderPickupService';
import { success, AppError } from '../utils/response';
import logger from '../config/logger';

const router = Router();

/**
 * POST /api/v1/partner/orders/pickup/verify-qr   { qrToken }
 * (via the API gateway: POST /api/v1/qc/partner/orders/pickup/verify-qr)
 *
 * The one endpoint the delivery-partner mobile app calls. Verifies a scanned
 * Order Pickup QR and, on success, flips the order READY → HANDED_OVER.
 */
router.post(
  '/orders/pickup/verify-qr',
  ...requirePartner,
  async (req: PartnerRequest, res: Response, next: NextFunction) => {
    try {
      const raw = String(req.body?.qrToken ?? req.body?.qrString ?? req.body?.token ?? '').trim();
      logger.info('[PickupQR] Partner verify request received', {
        partnerUid: req.partner?.uid,
        expectedOrderId: req.body?.expectedOrderId || null,
        qrField: req.body?.qrToken ? 'qrToken' : req.body?.qrString ? 'qrString' : req.body?.token ? 'token' : 'missing',
        qrLength: raw.length,
        hasPrefix: raw.startsWith('ORDER_PICKUP:'),
      });
      if (!raw) {
        throw new AppError('qrToken is required', 400, undefined, 'INVALID_QR');
      }
      const expectedOrderId = String(req.body?.expectedOrderId ?? '').trim() || undefined;
      const result = await OrderPickupService.verifyAndCompletePickup(req.partner!, raw, expectedOrderId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
