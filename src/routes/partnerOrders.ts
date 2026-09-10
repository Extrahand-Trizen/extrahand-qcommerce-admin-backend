import { Router, Response, NextFunction } from 'express';
import { requirePartner, PartnerRequest } from '../middleware/partnerAuth';
import { PartnerCompletionService } from '../services/PartnerCompletionService';
import { success } from '../utils/response';

const router = Router();

/**
 * POST /api/v1/partner/orders/:orderId/complete
 * (via the API gateway: POST /api/v1/qc/partner/orders/:orderId/complete)
 *
 * The delivery partner marks a picked-up order delivered. Only the partner who
 * scanned the pickup QR for this order (`order.partnerUid`) may complete it, and
 * only while the order is HANDED_OVER. On success: HANDED_OVER → COMPLETED,
 * parent status → DELIVERED, and the seller's store room is notified in real time.
 */
router.post(
  '/orders/:orderId/complete',
  ...requirePartner,
  async (req: PartnerRequest, res: Response, next: NextFunction) => {
    try {
      const result = await PartnerCompletionService.completeOrder(
        req.partner!,
        req.params.orderId,
      );
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
