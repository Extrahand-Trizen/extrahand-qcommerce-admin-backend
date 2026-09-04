import { Router, Response, NextFunction } from 'express';
import { AuthRequest, requireSeller } from '../middleware/auth';
import { success } from '../utils/response';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { ProductSubmissionService } from '../services/ProductSubmissionService';
import { QcOrderService } from '../services/QcOrderService';
import { OrderFulfillmentService, FulfillmentAction } from '../services/OrderFulfillmentService';
import { registerSellerToken, unregisterSellerToken } from '../services/PushService';
import { getSellerMetrics } from '../services/SellerMetricsService';
import { uploadImage } from '../middleware/upload';
import { uploadFile } from '../utils/storage';

const router = Router();

/* -------- read -------- */

// GET /api/v1/seller/categories
router.get('/categories', ...requireSeller, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerCatalogueService.listCategories());
  } catch (e) { next(e); }
});

// GET /api/v1/seller/master-products?categoryId=&subcategoryId=&search=&page=&limit=
router.get('/master-products', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await SellerCatalogueService.listMasterProducts(req.user!.sellerId!, req.query as never),
    );
  } catch (e) { next(e); }
});

// GET /api/v1/seller/master-products/:id — all read-only catalogue data (add-to-store setup)
router.get('/master-products/:id', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerCatalogueService.getMasterProductDetail(req.params.id));
  } catch (e) { next(e); }
});

// GET /api/v1/seller/listings?categoryId=&availability=&search=&page=&limit=
router.get('/listings', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await SellerCatalogueService.listMyListings(req.user!.sellerId!, req.query as never),
    );
  } catch (e) { next(e); }
});

// GET /api/v1/seller/listings/:id — one listing + all read-only master-catalogue data
router.get('/listings/:id', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await SellerCatalogueService.getListingDetail(req.user!.sellerId!, req.params.id),
    );
  } catch (e) { next(e); }
});

/* -------- write -------- */

// POST /api/v1/seller/listings  { masterProductId, sellingPricePaise?, availability? }
router.post('/listings', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerCatalogueService.addListing(req.user!.sellerId!, req.body), 201);
  } catch (e) { next(e); }
});

// POST /api/v1/seller/listings/bulk  { items:[{masterProductId, sellingPricePaise?}], defaults:{availability?} }
router.post('/listings/bulk', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerCatalogueService.addListingsBulk(req.user!.sellerId!, req.body), 201);
  } catch (e) { next(e); }
});

// PATCH /api/v1/seller/listings/bulk  { ids:[], patch:{availability?, enabled?} }
router.patch('/listings/bulk', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerCatalogueService.updateListingsBulk(req.user!.sellerId!, req.body));
  } catch (e) { next(e); }
});

// GET /api/v1/seller/orders — paid orders for this seller's storefront only
router.get('/orders', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await QcOrderService.listSellerOrders(req.user!.sellerId!));
  } catch (e) { next(e); }
});

// GET /api/v1/seller/orders/:id
router.get('/orders/:id', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await QcOrderService.getSellerOrder(req.user!.sellerId!, req.params.id));
  } catch (e) { next(e); }
});

// GET /api/v1/seller/metrics?window=24h|7d|30d — Track E shop health
router.get('/metrics', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await getSellerMetrics(req.user!.sellerId!, String(req.query.window || '7d')));
  } catch (e) { next(e); }
});

/* -------- order fulfilment actions (backend owns the state machine) -------- */

const fulfillmentAction = (action: FulfillmentAction) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      return success(
        res,
        await OrderFulfillmentService.transition(
          req.user!.sellerId!,
          req.params.id,
          action,
          req.body ?? {},
        ),
      );
    } catch (e) { next(e); }
  };

// POST /api/v1/seller/orders/:id/accept          { prepMinutes }
router.post('/orders/:id/accept', ...requireSeller, fulfillmentAction('accept'));
// POST /api/v1/seller/orders/:id/reject          { reason, note? }
router.post('/orders/:id/reject', ...requireSeller, fulfillmentAction('reject'));
// POST /api/v1/seller/orders/:id/start-preparing
router.post('/orders/:id/start-preparing', ...requireSeller, fulfillmentAction('start-preparing'));
// POST /api/v1/seller/orders/:id/mark-ready
router.post('/orders/:id/mark-ready', ...requireSeller, fulfillmentAction('mark-ready'));
// POST /api/v1/seller/orders/:id/extend-prep   { addMinutes }
router.post('/orders/:id/extend-prep', ...requireSeller, fulfillmentAction('extend-prep'));
// POST /api/v1/seller/orders/:id/items/:index/prep-check   { checked }
router.post('/orders/:id/items/:index/prep-check', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await OrderFulfillmentService.setItemPrepCheck(
      req.user!.sellerId!,
      req.params.id,
      Number(req.params.index),
      Boolean(req.body?.checked),
    ));
  } catch (e) { next(e); }
});
// POST /api/v1/seller/orders/:id/mark-handed-over { handoverCode }
router.post('/orders/:id/mark-handed-over', ...requireSeller, fulfillmentAction('mark-handed-over'));

/* -------- Track B — device push token for the new-order alert -------- */

// POST /api/v1/seller/push-token   { token }
router.post('/push-token', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await registerSellerToken(req.user!.sellerId!, String(req.body?.token || ''));
    return success(res, { registered: true });
  } catch (e) { next(e); }
});

// DELETE /api/v1/seller/push-token  { token }
router.delete('/push-token', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await unregisterSellerToken(req.user!.sellerId!, String(req.body?.token || ''));
    return success(res, { unregistered: true });
  } catch (e) { next(e); }
});

// POST /api/v1/seller/listings/bulk-delete  { ids:[] }  — hard remove several at once
router.post('/listings/bulk-delete', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerCatalogueService.deleteListingsBulk(req.user!.sellerId!, req.body));
  } catch (e) { next(e); }
});

// PATCH /api/v1/seller/listings/:id  { sellingPricePaise?, availability?, enabled? }
router.patch('/listings/:id', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await SellerCatalogueService.updateListing(req.user!.sellerId!, req.params.id, req.body),
    );
  } catch (e) { next(e); }
});

// DELETE /api/v1/seller/listings/:id  — remove from store completely (stays in catalogue)
router.delete('/listings/:id', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await SellerCatalogueService.deleteListing(req.user!.sellerId!, req.params.id));
  } catch (e) { next(e); }
});

/* -------- request a product (not in the catalogue) -------- */

// POST /api/v1/seller/product-requests  { name, categoryId, packOrSoldAs?, sellingPricePaise?, photoUrl? }
router.post('/product-requests', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await ProductSubmissionService.createRequest(req.user!.sellerId!, req.body), 201);
  } catch (e) { next(e); }
});

// POST /api/v1/seller/product-requests/bulk  { items:[{name, categoryId, packOrSoldAs?, sellingPricePaise?}] }
router.post('/product-requests/bulk', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await ProductSubmissionService.createRequestsBulk(req.user!.sellerId!, req.body), 201);
  } catch (e) { next(e); }
});

// GET /api/v1/seller/product-requests/mine?status=&page=&limit=
router.get('/product-requests/mine', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await ProductSubmissionService.listMine(req.user!.sellerId!, req.query as never));
  } catch (e) { next(e); }
});

// PATCH /api/v1/seller/product-requests/:id  — edit & resubmit (only REJECTED / CHANGES_REQUIRED)
router.patch('/product-requests/:id', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await ProductSubmissionService.resubmit(req.user!.sellerId!, req.params.id, req.body));
  } catch (e) { next(e); }
});

// POST /api/v1/seller/product-requests/photo  (multipart "image") -> { photoUrl }
router.post(
  '/product-requests/photo',
  ...requireSeller,
  uploadImage.single('image'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'No image provided' });
      const result = await uploadFile(req.file, 'product-requests');
      return success(res, { photoUrl: result.url }, 201);
    } catch (e) { next(e); }
  },
);

export default router;
