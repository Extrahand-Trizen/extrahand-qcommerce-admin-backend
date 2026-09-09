import { Router, Response, NextFunction } from 'express';
import { requirePartner, PartnerRequest } from '../middleware/partnerAuth';
import { OrderPickupService } from '../services/OrderPickupService';
import { success, AppError } from '../utils/response';

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
      if (!raw) {
        throw new AppError('qrToken is required', 400, undefined, 'INVALID_QR');
      }
      const result = await OrderPickupService.verifyAndCompletePickup(req.partner!, raw);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
