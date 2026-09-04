import { Router, Response, NextFunction } from 'express';
import { ProductSubmissionService } from '../services/ProductSubmissionService';
import { AuthRequest, requireCatalogueAdmin } from '../middleware/auth';
import { success } from '../utils/response';

const router = Router();
const admin = requireCatalogueAdmin;

router.get('/', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await ProductSubmissionService.list(req.query as never)); } catch (e) { next(e); }
});

router.get('/:id', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return success(res, await ProductSubmissionService.getById(req.params.id)); } catch (e) { next(e); }
});

router.post('/:id/review', ...admin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      action,
      adminComment,
      masterProductId,
      subcategoryId,
      productTypeId,
      name,
      brand,
      description,
      sku,
      gtin,
      complianceInfo,
      attributes,
      images,
      productInformation,
      sellingPricePaise,
      createSellerListing,
    } = req.body;
    return success(res, await ProductSubmissionService.review(
      req.params.id, action, adminComment, req.user!.sub,
      {
        masterProductId,
        subcategoryId,
        productTypeId,
        name,
        brand,
        description,
        sku,
        gtin,
        complianceInfo,
        attributes,
        images,
        productInformation,
        sellingPricePaise,
        createSellerListing,
      },
    ));
  } catch (e) { next(e); }
});

export default router;
