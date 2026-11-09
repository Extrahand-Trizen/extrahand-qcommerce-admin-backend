import { Router, Response, NextFunction } from 'express';
import { AuthRequest, requirePermission } from '../middleware/auth';
import { success } from '../utils/response';
import { PromotionService } from '../services/PromotionService';
import { StaffActivityService } from '../services/StaffActivityService';

const router = Router();

// GET /api/v1/seller/promotions?status=active&trigger=code
router.get('/promotions', ...requirePermission('coupons:view', 'coupons:manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.list(req.user!.sellerId!, req.query as never));
  } catch (e) { next(e); }
});

// GET /api/v1/seller/offers — per-product view of every product discount + how
// much has been given away. Feeds the seller "Discounts on products" screen.
router.get('/offers', ...requirePermission('coupons:view', 'coupons:manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.listProductOffers(req.user!.sellerId!));
  } catch (e) { next(e); }
});

// GET /api/v1/seller/promotions/:id
router.get('/promotions/:id', ...requirePermission('coupons:view', 'coupons:manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.getOne(req.user!.sellerId!, req.params.id));
  } catch (e) { next(e); }
});

// POST /api/v1/seller/promotions
router.post('/promotions', ...requirePermission('coupons:manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const created = await PromotionService.create(req.user!.sellerId!, req.body);
    StaffActivityService.recordActivity({
      sellerId: req.user!.sellerId!,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'coupons',
      action: 'COUPON_CREATE',
      entityType: 'Promotion',
      entityId: (created as any)?._id?.toString() || '',
      entityIdentifier: req.body?.code || req.body?.title || '',
      updatedValue: req.body,
    });
    return success(res, created, 201);
  } catch (e) { next(e); }
});

// PATCH /api/v1/seller/promotions/:id
router.patch('/promotions/:id', ...requirePermission('coupons:manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const updated = await PromotionService.update(req.user!.sellerId!, req.params.id, req.body);
    StaffActivityService.recordActivity({
      sellerId: req.user!.sellerId!,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'coupons',
      action: 'COUPON_UPDATE',
      entityType: 'Promotion',
      entityId: req.params.id,
      updatedValue: req.body,
    });
    return success(res, updated);
  } catch (e) { next(e); }
});

// POST /api/v1/seller/promotions/:id/pause
router.post('/promotions/:id/pause', ...requirePermission('coupons:manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await PromotionService.setState(req.user!.sellerId!, req.params.id, 'PAUSED');
    StaffActivityService.recordActivity({
      sellerId: req.user!.sellerId!,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'coupons',
      action: 'COUPON_PAUSE',
      entityType: 'Promotion',
      entityId: req.params.id,
    });
    return success(res, result);
  } catch (e) { next(e); }
});

// POST /api/v1/seller/promotions/:id/resume
router.post('/promotions/:id/resume', ...requirePermission('coupons:manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await PromotionService.setState(req.user!.sellerId!, req.params.id, 'ACTIVE');
    StaffActivityService.recordActivity({
      sellerId: req.user!.sellerId!,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'coupons',
      action: 'COUPON_RESUME',
      entityType: 'Promotion',
      entityId: req.params.id,
    });
    return success(res, result);
  } catch (e) { next(e); }
});

// DELETE /api/v1/seller/promotions/:id
router.delete('/promotions/:id', ...requirePermission('coupons:manage'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await PromotionService.remove(req.user!.sellerId!, req.params.id);
    StaffActivityService.recordActivity({
      sellerId: req.user!.sellerId!,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'coupons',
      action: 'COUPON_DELETE',
      entityType: 'Promotion',
      entityId: req.params.id,
    });
    return success(res, result);
  } catch (e) { next(e); }
});

export default router;
