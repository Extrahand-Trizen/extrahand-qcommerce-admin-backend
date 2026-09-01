import { Router, Request, Response, NextFunction } from 'express';
import { StorefrontService } from '../services/StorefrontService';
import { success } from '../utils/response';

const router = Router();

router.get('/store/home', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellerId = typeof req.query.sellerId === 'string' ? req.query.sellerId : undefined;
    return success(res, await StorefrontService.getHome({ sellerId }));
  } catch (e) {
    next(e);
  }
});

router.get('/store/categories', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return success(res, await StorefrontService.getCategoryGroups());
  } catch (e) {
    next(e);
  }
});

router.get(
  '/store/subcategories/:slug/product-types',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      return success(res, await StorefrontService.getSubcategoryProductTypes(req.params.slug));
    } catch (e) {
      next(e);
    }
  },
);

router.get('/store/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    return success(res, await StorefrontService.listProducts(req.query as never));
  } catch (e) {
    next(e);
  }
});

router.get('/store/products/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellerId = typeof req.query.sellerId === 'string' ? req.query.sellerId : undefined;
    return success(res, await StorefrontService.getProductBySlug(req.params.slug, { sellerId }));
  } catch (e) {
    next(e);
  }
});

export default router;
