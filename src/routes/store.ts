import { Router, Request, Response, NextFunction } from 'express';
import { StorefrontService } from '../services/StorefrontService';
import { success } from '../utils/response';

const router = Router();

router.get('/store/home', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return success(res, await StorefrontService.getHome());
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

router.get('/store/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    return success(res, await StorefrontService.listProducts(req.query as never));
  } catch (e) {
    next(e);
  }
});

router.get('/store/products/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    return success(res, await StorefrontService.getProductBySlug(req.params.slug));
  } catch (e) {
    next(e);
  }
});

export default router;
