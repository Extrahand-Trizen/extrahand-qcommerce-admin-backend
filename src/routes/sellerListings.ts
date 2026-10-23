import { Router, Response, NextFunction } from 'express';
import SellerListing from '../models/SellerListing';
import PriceReviewLog from '../models/PriceReviewLog';
import ShopInventory from '../models/ShopInventory';
import ProductSubmission from '../models/ProductSubmission';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { AuthRequest, requireAdmin, requireSeller } from '../middleware/auth';
import { success, AppError } from '../utils/response';
import { paginate } from '../utils/pagination';

import SellerOnboarding from '../models/SellerOnboarding';
import Attribute from '../models/Attribute';

const router = Router();

router.get('/stats', ...requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filter: Record<string, any> = {};
    if (req.query.sellerId && req.query.sellerId !== 'all') {
      filter.sellerId = req.query.sellerId;
    }

    const [underReview, approved, rejected, all] = await Promise.all([
      SellerListing.countDocuments({ ...filter, reviewStatus: { $in: ['UNDER_REVIEW', 'PENDING_REVIEW'] } }),
      SellerListing.countDocuments({ ...filter, reviewStatus: 'APPROVED' }),
      PriceReviewLog.countDocuments({ ...(filter.sellerId ? { sellerId: filter.sellerId } : {}), status: 'REJECTED' }),
      SellerListing.countDocuments(filter),
    ]);

    return success(res, {
      underReview,
      approved,
      rejected,
      all,
    });
  } catch (e) { next(e); }
});

router.get('/', ...requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const reviewStatus = req.query.reviewStatus as string | undefined;

    if (reviewStatus === 'REJECTED') {
      const filter: Record<string, any> = { status: 'REJECTED' };
      if (req.query.sellerId) filter.sellerId = req.query.sellerId;

      const populateOpts = [
        { path: 'sellerId', select: 'shopName storeName fullName phone mobileNumber' },
        { path: 'masterProductId', select: 'name brand categoryId categoryName subcategoryName imageUrl sellingPricePaise packOrSoldAs variant attributes description productInformation lifespanValue lifespanUnit vertical isMedicalProduct' },
        { path: 'sellerListingId', select: 'sellingPricePaise unit reviewStatus' },
      ];

      const result = await paginate(PriceReviewLog, filter, req.query as never, populateOpts as any);

      const sellerIds = result.items.map((i: any) => i.sellerId?._id || i.sellerId).filter(Boolean);
      const onboardings = sellerIds.length ? await SellerOnboarding.find({ sellerId: { $in: sellerIds } }).select('sellerId shopName fullName mobileNumber').lean() : [];
      const obMap = new Map(onboardings.map((o) => [String(o.sellerId), o]));

      const items = result.items.map((log: any) => {
        const sid = String(log.sellerId?._id || log.sellerId || '');
        const ob = obMap.get(sid);
        const sellerObj = log.sellerId && typeof log.sellerId === 'object' ? { ...log.sellerId } : { _id: sid };
        if (ob?.shopName && !sellerObj.shopName) sellerObj.shopName = ob.shopName;
        if (ob?.fullName && !sellerObj.fullName) sellerObj.fullName = ob.fullName;

        return {
          _id: String(log.sellerListingId?._id || log.sellerListingId || log._id),
          logId: String(log._id),
          sellerId: sellerObj,
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
        };
      });

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
      { path: 'sellerId', select: 'shopName storeName fullName phone mobileNumber' },
      { path: 'masterProductId', select: 'name brand categoryId categoryName subcategoryName imageUrl sellingPricePaise packOrSoldAs variant attributes description productInformation lifespanValue lifespanUnit vertical isMedicalProduct' },
    ];

    const result = await paginate(SellerListing, filter, req.query as never, populateOpts as any);

    // Collect all attribute IDs to resolve readable labels for diff viewer
    const allAttrIds: string[] = [];
    result.items.forEach((i: any) => {
      const masterAttrs = i.masterProductId?.attributes || [];
      const customAttrs = i.customAttributes || [];
      [...masterAttrs, ...customAttrs].forEach((a: any) => {
        if (a?.attributeId) allAttrIds.push(String(a.attributeId));
      });
    });

    const attrDocs = allAttrIds.length > 0
      ? await Attribute.find({ _id: { $in: allAttrIds } }).select('name key').lean()
      : [];
    const attrNameMap = new Map<string, string>();
    attrDocs.forEach((doc: any) => {
      attrNameMap.set(String(doc._id), doc.name);
      if (doc.key) attrNameMap.set(String(doc.key).toLowerCase(), doc.name);
    });

    const sellerIds = result.items.map((i: any) => i.sellerId?._id || i.sellerId).filter(Boolean);
    const onboardings = sellerIds.length > 0
      ? await SellerOnboarding.find({ sellerId: { $in: sellerIds } }).select('sellerId shopName fullName mobileNumber').lean()
      : [];
    const obMap = new Map(onboardings.map((o) => [String(o.sellerId), o]));

    const enriched = result.items.map((i: any) => {
      const itemObj = i.toObject ? i.toObject() : { ...i };
      const sid = String(itemObj.sellerId?._id || itemObj.sellerId || '');
      const ob = obMap.get(sid);
      if (ob) {
        if (!itemObj.sellerId || typeof itemObj.sellerId !== 'object') {
          itemObj.sellerId = { _id: sid };
        }
        if (ob.shopName && !itemObj.sellerId.shopName) {
          itemObj.sellerId.shopName = ob.shopName;
        }
        if (ob.fullName && !itemObj.sellerId.fullName) {
          itemObj.sellerId.fullName = ob.fullName;
        }
      }

      // Enrich masterProductId attributes with human-readable labels for diffs
      if (itemObj.masterProductId && Array.isArray(itemObj.masterProductId.attributes)) {
        itemObj.masterProductId.attributes = itemObj.masterProductId.attributes.map((a: any) => {
          const idStr = String(a.attributeId || '');
          const label = a.label || attrNameMap.get(idStr) || idStr;
          return {
            attributeId: a.attributeId,
            label,
            value: a.value,
          };
        });
      }

      // Seed baseline master productInformation with top-level fields & aliases
      if (itemObj.masterProductId) {
        const mp = itemObj.masterProductId;
        mp.productInformation = { ...(mp.productInformation || {}) };
        if (mp.brand && !mp.productInformation.brand) mp.productInformation.brand = mp.brand;
        if (!mp.productInformation.countryOfOrigin) mp.productInformation.countryOfOrigin = mp.countryOfOrigin || 'India';
        if (mp.lifespanValue != null && mp.productInformation.lifespanValue == null) mp.productInformation.lifespanValue = mp.lifespanValue;
        if (mp.lifespanUnit && !mp.productInformation.lifespanUnit) mp.productInformation.lifespanUnit = mp.lifespanUnit;
        if (mp.description && !mp.productInformation.description) mp.productInformation.description = mp.description;

        // Alias syncing
        const p = mp.productInformation;
        if (p.ingredients && !p.keyIngredients) p.keyIngredients = p.ingredients;
        if (p.keyIngredients && !p.ingredients) p.ingredients = p.keyIngredients;
        if (p.usageInstructions && !p.directionsForUse) p.directionsForUse = p.usageInstructions;
        if (p.directionsForUse && !p.usageInstructions) p.usageInstructions = p.directionsForUse;
        if (p.healthBenefits && !p.keyBenefits) p.keyBenefits = p.healthBenefits;
        if (p.keyBenefits && !p.healthBenefits) p.healthBenefits = p.keyBenefits;
        if (p.storageInformation && !p.storageCondition) p.storageCondition = p.storageInformation;
        if (p.storageCondition && !p.storageInformation) p.storageInformation = p.storageCondition;
        if (p.allergens && !p.allergenInfo) p.allergenInfo = p.allergens;
        if (p.allergenInfo && !p.allergens) p.allergens = p.allergenInfo;
      }

      return itemObj;
    });

    return success(res, { ...result, items: enriched });
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

router.delete('/:id', ...requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await SellerListing.findById(req.params.id);
    if (!listing) throw new AppError('Listing not found', 404);

    const { sellerId, masterProductId } = listing;

    await SellerListing.deleteOne({ _id: req.params.id });
    await ShopInventory.deleteOne({ listingId: req.params.id });

    if (sellerId && masterProductId) {
      await ProductSubmission.updateMany(
        { sellerId, mappedMasterProductId: masterProductId },
        { $set: { status: 'DELETED' } },
      );
    }

    return success(res, { message: 'Listing deleted successfully', deleted: true });
  } catch (e) { next(e); }
});

export default router;
