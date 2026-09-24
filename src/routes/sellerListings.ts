import { Router, Response, NextFunction } from 'express';
import SellerListing from '../models/SellerListing';
import PriceReviewLog from '../models/PriceReviewLog';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { AuthRequest, requireAdmin, requireSeller } from '../middleware/auth';
import { success, AppError } from '../utils/response';
import { paginate } from '../utils/pagination';

const router = Router();

router.get('/', ...requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const reviewStatus = req.query.reviewStatus as string | undefined;

    if (reviewStatus === 'REJECTED') {
      const filter: Record<string, any> = { status: 'REJECTED' };
      if (req.query.sellerId) filter.sellerId = req.query.sellerId;

      const populateOpts = [
        { path: 'sellerId', select: 'shopName storeName fullName phone' },
        { path: 'masterProductId', select: 'name brand categoryId categoryName subcategoryName imageUrl sellingPricePaise packOrSoldAs variant attributes description productInformation lifespanValue lifespanUnit' },
        { path: 'sellerListingId', select: 'sellingPricePaise unit reviewStatus' },
      ];

      const result = await paginate(PriceReviewLog, filter, req.query as never, populateOpts as any);

      const items = result.items.map((log: any) => ({
        _id: String(log.sellerListingId?._id || log.sellerListingId || log._id),
        logId: String(log._id),
        sellerId: log.sellerId,
        masterProductId: log.masterProductId,
        unit: log.previousUnit || log.sellerListingId?.unit || log.masterProductId?.variant || 'Standard',
        sellingPricePaise: log.previousPricePaise || log.sellerListingId?.sellingPricePaise || 0,
        pendingSellingPricePaise: log.requestedPricePaise,
        pendingUnit: log.requestedUnit,
        reviewStatus: 'REJECTED',
        rejectionReason: log.rejectionReason,
        reviewSubmittedAt: log.createdAt,
        reviewedAt: log.reviewedAt,
        createdAt: log.createdAt,
        updatedAt: log.updatedAt,
      }));

      return success(res, {
        items,
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
        limit: result.limit,
      });
    }

    const filter: Record<string, any> = {};
    if (req.query.sellerId) filter.sellerId = req.query.sellerId;
    if (reviewStatus && reviewStatus !== 'ALL') {
      if (reviewStatus === 'UNDER_REVIEW' || reviewStatus === 'PENDING_REVIEW' || reviewStatus === 'PENDING') {
        filter.reviewStatus = { $in: ['UNDER_REVIEW', 'PENDING_REVIEW'] };
      } else {
        filter.reviewStatus = reviewStatus;
      }
    }

    const populateOpts = [
      { path: 'sellerId', select: 'shopName storeName fullName phone' },
      { path: 'masterProductId', select: 'name brand categoryId categoryName subcategoryName imageUrl sellingPricePaise packOrSoldAs variant attributes description productInformation lifespanValue lifespanUnit' },
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

router.patch('/:id', ...requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await SellerListing.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!listing) throw new AppError('Listing not found', 404);
    return success(res, listing);
  } catch (e) { next(e); }
});

router.post('/:id/approve', ...requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await SellerCatalogueService.approveListing(req.params.id);
    return success(res, listing);
  } catch (e) { next(e); }
});

router.post('/:id/reject', ...requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason, note } = req.body ?? {};
    const rejectionReason = reason || note || 'Request rejected by admin';
    const listing = await SellerCatalogueService.rejectListing(req.params.id, rejectionReason);
    return success(res, listing);
  } catch (e) { next(e); }
});

export default router;
