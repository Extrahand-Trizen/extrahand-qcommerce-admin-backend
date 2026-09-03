import { Router, Request, Response, NextFunction } from 'express';
import { StorefrontService } from '../services/StorefrontService';
import { CustomerStoreService } from '../services/CustomerStoreService';
import { QcOrderService } from '../services/QcOrderService';
import { AuthRequest, authenticateCustomer } from '../middleware/auth';
import { success } from '../utils/response';

const router = Router();

function readSellerId(req: Request): string | undefined {
  return typeof req.query.sellerId === 'string' ? req.query.sellerId : undefined;
}

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

router.get('/store/cart', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return success(res, await CustomerStoreService.getCart(req.user!.sub, { sellerId: readSellerId(req) }));
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
        { sellerId: readSellerId(req) },
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
        { sellerId: readSellerId(req) },
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
      await CustomerStoreService.removeCartItem(req.user!.sub, req.params.slug, {
        sellerId: readSellerId(req),
      }),
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
      await CustomerStoreService.getWishlist(req.user!.sub, { sellerId: readSellerId(req) }),
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
      await CustomerStoreService.addWishlistItem(req.user!.sub, productSlug, {
        sellerId: readSellerId(req),
      }),
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
        await CustomerStoreService.removeWishlistItem(req.user!.sub, req.params.slug, {
          sellerId: readSellerId(req),
        }),
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

// POST /api/v1/store/coupons/validate — preview a discount code against the cart
router.post('/store/coupons/validate', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body ?? {};
    return success(
      res,
      await QcOrderService.validateCoupon(req.user!.sub, String(code ?? ''), {
        sellerId: readSellerId(req),
      }),
    );
  } catch (e) {
    next(e);
  }
});

router.post('/store/orders/checkout', authenticateCustomer, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { address, deliveryInstructions, partnerTipPaise, couponCode, couponDiscountPaise } = req.body ?? {};
    return success(
      res,
      await QcOrderService.checkout(
        req.user!.sub,
        { address, deliveryInstructions, partnerTipPaise, couponCode, couponDiscountPaise },
        { sellerId: readSellerId(req) },
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
    return success(res, await QcOrderService.listOrders(req.user!.sub));
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

export default router;
