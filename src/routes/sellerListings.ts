import { Router, Response, NextFunction } from 'express';
import SellerListing from '../models/SellerListing';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { AuthRequest, requireSellerAdmin, requireSeller } from '../middleware/auth';
import { success, AppError } from '../utils/response';
import { paginate } from '../utils/pagination';

const router = Router();

router.get('/', ...requireSellerAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filter: Record<string, any> = {};
    if (req.query.sellerId) filter.sellerId = req.query.sellerId;
    if (req.query.reviewStatus) filter.reviewStatus = req.query.reviewStatus;

    const populateOpts = [
      { path: 'sellerId', select: 'shopName storeName fullName phone' },
      { path: 'masterProductId', select: 'name brand categoryId categoryName subcategoryName imageUrl sellingPricePaise packOrSoldAs variant' },
    ];

    const result = await paginate(SellerListing, filter, req.query as never, populateOpts as any);
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

router.patch('/:id', ...requireSellerAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await SellerListing.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!listing) throw new AppError('Listing not found', 404);
    return success(res, listing);
  } catch (e) { next(e); }
});

router.post('/:id/approve', ...requireSellerAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await SellerCatalogueService.approveListing(req.params.id);
    return success(res, listing);
  } catch (e) { next(e); }
});

router.post('/:id/reject', ...requireSellerAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await SellerCatalogueService.rejectListing(req.params.id);
    return success(res, listing);
  } catch (e) { next(e); }
});

export default router;
