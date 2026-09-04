import { Router, Response, NextFunction } from 'express';
import { AuthRequest, requireSeller } from '../middleware/auth';
import { success } from '../utils/response';
import { PromotionService } from '../services/PromotionService';

const router = Router();

// GET /api/v1/seller/promotions?status=active&trigger=code
router.get('/promotions', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.list(req.user!.sellerId!, req.query as never));
  } catch (e) { next(e); }
});

// GET /api/v1/seller/offers — per-product view of every product discount + how
// much has been given away. Feeds the seller "Discounts on products" screen.
router.get('/offers', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.listProductOffers(req.user!.sellerId!));
  } catch (e) { next(e); }
});

// GET /api/v1/seller/promotions/:id
router.get('/promotions/:id', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.getOne(req.user!.sellerId!, req.params.id));
  } catch (e) { next(e); }
});

// POST /api/v1/seller/promotions
router.post('/promotions', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.create(req.user!.sellerId!, req.body), 201);
  } catch (e) { next(e); }
});

// PATCH /api/v1/seller/promotions/:id
router.patch('/promotions/:id', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.update(req.user!.sellerId!, req.params.id, req.body));
  } catch (e) { next(e); }
});

// POST /api/v1/seller/promotions/:id/pause
router.post('/promotions/:id/pause', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.setState(req.user!.sellerId!, req.params.id, 'PAUSED'));
  } catch (e) { next(e); }
});

// POST /api/v1/seller/promotions/:id/resume
router.post('/promotions/:id/resume', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.setState(req.user!.sellerId!, req.params.id, 'ACTIVE'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/seller/promotions/:id
router.delete('/promotions/:id', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await PromotionService.remove(req.user!.sellerId!, req.params.id));
  } catch (e) { next(e); }
});

export default router;
