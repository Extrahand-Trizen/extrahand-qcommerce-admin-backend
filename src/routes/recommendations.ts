import { Router, Response, NextFunction } from 'express';
import { RecommendationService } from '../services/recommendationService';
import { AuthRequest, requireCatalogueAdmin, requireSeller } from '../middleware/auth';
import { success } from '../utils/response';

const router = Router();
const admin = requireCatalogueAdmin;

/* ==========================================================================
   ADMIN ROUTES: Recommendation Packs Management (/recommendation-groups)
   ========================================================================== */

// GET /api/v1/recommendation-groups - List all recommendation packs
router.get('/recommendation-groups', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await RecommendationService.listAdminGroups(req.query as any);
    return success(res, result);
  } catch (e) {
    next(e);
  }
});

// GET /api/v1/recommendation-groups/:id - Get single pack details
router.get('/recommendation-groups/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await RecommendationService.getGroupById(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Recommendation group not found' });
    }
    return success(res, result);
  } catch (e) {
    next(e);
  }
});

// POST /api/v1/recommendation-groups - Create a new recommendation pack
router.post('/recommendation-groups', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const group = await RecommendationService.createGroup(req.body, req.user?.sub);
    return success(res, group, 201);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/v1/recommendation-groups/:id - Update recommendation pack
router.patch('/recommendation-groups/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const group = await RecommendationService.updateGroup(req.params.id, req.body, req.user?.sub);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Recommendation group not found' });
    }
    return success(res, group);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/v1/recommendation-groups/:id - Delete recommendation pack
router.delete('/recommendation-groups/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deleted = await RecommendationService.deleteGroup(req.params.id);
    return success(res, { deleted });
  } catch (e) {
    next(e);
  }
});

/* ==========================================================================
   SELLER APP ROUTES: Starter Packs & Bulk Setup (/seller/recommendation-groups)
   ========================================================================== */

// GET /api/v1/seller/recommendation-groups?vertical=KIRANA&subcategories=...
router.get('/seller/recommendation-groups', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vertical = (req.query.vertical as string) || 'KIRANA';
    const subcategoriesRaw = req.query.subcategories as string | undefined;
    const subcategories = subcategoriesRaw
      ? subcategoriesRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const groups = await RecommendationService.getGroupsForVertical(vertical, subcategories);
    return success(res, groups);
  } catch (e) {
    next(e);
  }
});

// GET /api/v1/seller/recommendation-groups/:id/products?page=1&limit=50
router.get('/seller/recommendation-groups/:id/products', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
    const result = await RecommendationService.getGroupProducts(req.params.id, page, limit);
    return success(res, result);
  } catch (e) {
    next(e);
  }
});

// POST /api/v1/seller/recommendation-groups/bulk-add
router.post('/seller/recommendation-groups/bulk-add', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.user?.sellerId;
    if (!sellerId) {
      return res.status(400).json({ success: false, error: 'Seller context missing' });
    }

    const result = await RecommendationService.bulkAddProductsToSeller(sellerId, req.body);
    return success(res, result, 201);
  } catch (e) {
    next(e);
  }
});

export default router;
