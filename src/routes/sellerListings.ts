import { Router, Response, NextFunction } from 'express';
import SellerListing from '../models/SellerListing';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { AuthRequest, requireAdmin, requireSeller } from '../middleware/auth';
import { success, AppError } from '../utils/response';
import { paginate } from '../utils/pagination';

const router = Router();

router.get('/', ...requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await paginate(SellerListing, req.query.sellerId ? { sellerId: req.query.sellerId } : {}, req.query as never, ['sellerId', 'masterProductId']);
    return success(res, result);
  } catch (e) { next(e); }
});

router.post('/', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.user!.sellerId!;
    const { masterProductId, sellingPricePaise, availability } = req.body ?? {};
    if (!masterProductId || typeof masterProductId !== 'string') {
      throw new AppError('masterProductId is required', 400);
    }
    const listing = await SellerCatalogueService.addListing(sellerId, {
      masterProductId,
      sellingPricePaise,
      availability,
    });
    return success(res, listing, 201);
  } catch (e) { next(e); }
});

router.patch('/:id', ...requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await SellerListing.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!listing) throw new AppError('Listing not found', 404);
    return success(res, listing);
  } catch (e) { next(e); }
});

export default router;
