import { Router, Request, Response, NextFunction } from 'express';
import { StorefrontService } from '../services/StorefrontService';
import { CustomerStoreService } from '../services/CustomerStoreService';
import { QcOrderService } from '../services/QcOrderService';
import { AuthRequest, authenticateCustomer } from '../middleware/auth';
import { success } from '../utils/response';
import { parseStorefrontLocationQuery } from '../services/storefront/storefrontListingQueries';

const router = Router();

/** Parse seller + lat/lng/pin/city from the request query string. */
function readStorefrontQuery(req: Request) {
  return parseStorefrontLocationQuery(req.query as Record<string, unknown>);
}

router.get('/store/home', async (req: Request, res: Response, next: NextFunction) => {
  try {
    return success(res, await StorefrontService.getHome(readStorefrontQuery(req)));
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
    const location = readStorefrontQuery(req);
    const q = req.query;
    return success(
      res,
      await StorefrontService.listProducts({
        ...location,
        page: q.page != null ? Number(q.page) : undefined,
        limit: q.limit != null ? Number(q.limit) : undefined,
        search: typeof q.search === 'string' ? q.search : undefined,
        categorySlug: typeof q.categorySlug === 'string' ? q.categorySlug : undefined,
        subcategorySlug: typeof q.subcategorySlug === 'string' ? q.subcategorySlug : undefined,
        productTypeSlug: typeof q.productTypeSlug === 'string' ? q.productTypeSlug : undefined,
        brands: typeof q.brands === 'string' ? q.brands : undefined,
        minPrice: q.minPrice != null ? Number(q.minPrice) : undefined,
        maxPrice: q.maxPrice != null ? Number(q.maxPrice) : undefined,
      }),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/store/products/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await StorefrontService.getProductBySlug(req.params.slug, readStorefrontQuery(req)),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/store/product-filters', async (req: Request, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await StorefrontService.getFilterFacets({
        categorySlug: typeof req.query.categorySlug === 'string' ? req.query.categorySlug : undefined,
        subcategorySlug:
          typeof req.query.subcategorySlug === 'string' ? req.query.subcategorySlug : undefined,
        productTypeSlug:
          typeof req.query.productTypeSlug === 'string' ? req.query.productTypeSlug : undefined,
      }),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/store/cart', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await CustomerStoreService.getCart(req.user!.sub, readStorefrontQuery(req)));
  } catch (e) {
    next(e);
  }
});

router.put('/store/cart/items', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { productSlug, quantity } = req.body ?? {};
    return success(
      res,
      await CustomerStoreService.upsertCartItem(
        req.user!.sub,
        { productSlug, quantity },
        readStorefrontQuery(req),
      ),
    );
  } catch (e) {
    next(e);
  }
});

router.patch('/store/cart/items/:slug', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await CustomerStoreService.updateCartItemQuantity(
        req.user!.sub,
        req.params.slug,
        req.body?.quantity,
        readStorefrontQuery(req),
      ),
    );
  } catch (e) {
    next(e);
  }
});

router.delete('/store/cart/items/:slug', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await CustomerStoreService.removeCartItem(
        req.user!.sub,
        req.params.slug,
        readStorefrontQuery(req),
      ),
    );
  } catch (e) {
    next(e);
  }
});

router.delete('/store/cart', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await CustomerStoreService.clearCart(req.user!.sub));
  } catch (e) {
    next(e);
  }
});

router.get('/store/wishlist', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await CustomerStoreService.getWishlist(req.user!.sub, readStorefrontQuery(req)),
    );
  } catch (e) {
    next(e);
  }
});

router.put('/store/wishlist/items', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { productSlug } = req.body ?? {};
    return success(
      res,
      await CustomerStoreService.addWishlistItem(
        req.user!.sub,
        productSlug,
        readStorefrontQuery(req),
      ),
    );
  } catch (e) {
    next(e);
  }
});

router.delete(
  '/store/wishlist/items/:slug',
  authenticateCustomer,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      return success(
        res,
        await CustomerStoreService.removeWishlistItem(
          req.user!.sub,
          req.params.slug,
          readStorefrontQuery(req),
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.delete('/store/wishlist', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await CustomerStoreService.clearWishlist(req.user!.sub));
  } catch (e) {
    next(e);
  }
});

router.get('/store/coupons', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await QcOrderService.listAvailableCoupons(req.user!.sub, readStorefrontQuery(req)),
    );
  } catch (e) {
    next(e);
  }
});

router.post('/store/coupons/validate', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body ?? {};
    return success(
      res,
      await QcOrderService.validateCoupon(
        req.user!.sub,
        String(code ?? ''),
        readStorefrontQuery(req),
      ),
    );
  } catch (e) {
    next(e);
  }
});

router.post('/store/orders/checkout', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { address, deliveryInstructions, partnerTipPaise, couponCode, couponDiscountPaise } =
      req.body ?? {};
    return success(
      res,
      await QcOrderService.checkout(
        req.user!.sub,
        { address, deliveryInstructions, partnerTipPaise, couponCode, couponDiscountPaise },
        readStorefrontQuery(req),
      ),
      201,
    );
  } catch (e) {
    next(e);
  }
});

router.post('/store/orders/:id/confirm-payment', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body ?? {};
    return success(
      res,
      await QcOrderService.confirmPayment(req.user!.sub, req.params.id, {
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
      }),
    );
  } catch (e) {
    next(e);
  }
});

router.post('/store/orders/:id/abandon', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await QcOrderService.abandon(req.user!.sub, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.get('/store/orders', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const raw = String(req.query.filter || 'all').toLowerCase();
    const filter =
      raw === 'active' || raw === 'completed' || raw === 'cancelled' || raw === 'all'
        ? (raw as 'all' | 'active' | 'completed' | 'cancelled')
        : 'all';
    return success(res, await QcOrderService.listOrders(req.user!.sub, { filter }));
  } catch (e) {
    next(e);
  }
});

router.get('/store/transactions', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rawCategory = String(req.query.category || 'all').toLowerCase();
    const category =
      rawCategory === 'outgoing' || rawCategory === 'refunds'
        ? rawCategory
        : 'all';
    return success(
      res,
      await QcOrderService.listTransactions(req.user!.sub, {
        limit: req.query.limit != null ? Number(req.query.limit) : undefined,
        offset: req.query.offset != null ? Number(req.query.offset) : undefined,
        category,
        startDate:
          typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
        endDate:
          typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
      }),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/store/orders/:id/invoice', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await QcOrderService.getInvoice(req.user!.sub, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.get('/store/orders/:id', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await QcOrderService.getOrder(req.user!.sub, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.delete('/store/orders/:id', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await QcOrderService.removeFromHistory(req.user!.sub, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.post('/store/orders/:id/cancel', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(
      res,
      await QcOrderService.cancelByCustomer(req.user!.sub, req.params.id, {
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      }),
    );
  } catch (e) {
    next(e);
  }
});

export default router;
