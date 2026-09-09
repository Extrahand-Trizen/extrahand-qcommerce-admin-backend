import { Router, Response, NextFunction } from 'express';
import { AuthRequest, requireSeller } from '../middleware/auth';
import { success, AppError } from '../utils/response';
import { SellerPaymentService } from '../services/SellerPaymentService';

const router = Router();

/**
 * Middleware: Verify that client is not attempting to request another store's
 * data by passing a conflicting storeId or sellerId in query or body.
 */
function enforceStoreAuthorization(req: AuthRequest, _res: Response, next: NextFunction) {
  const authorizedSellerId = req.user?.sellerId;
  if (!authorizedSellerId) {
    return next(new AppError('Unauthorized: Seller context missing', 401));
  }

  const requestedStoreId =
    (req.query.storeId as string) ||
    (req.query.sellerId as string) ||
    (req.body?.storeId as string) ||
    (req.body?.sellerId as string);

  if (requestedStoreId && requestedStoreId.trim() !== authorizedSellerId.toString()) {
    return next(
      new AppError('Forbidden: Access to another shop\'s payment data is denied', 403),
    );
  }

  next();
}

const sellerAuthAndGate = [...requireSeller, enforceStoreAuthorization];

// GET /payments — list only payments belonging to the authenticated shop
router.get(
  '/payments',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerPaymentService.listPayments(sellerId, {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        status: req.query.status as string,
        paymentMode: req.query.paymentMode as string,
      });
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

// GET /revenue — aggregated financial metrics for this shop only
router.get(
  '/revenue',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerPaymentService.getRevenueAnalytics(sellerId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

// GET /settlements — settlement ledger and payout breakdown for this shop only
router.get(
  '/settlements',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerPaymentService.getSettlements(sellerId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

// GET /transactions — transaction log for this shop only
router.get(
  '/transactions',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerPaymentService.getTransactions(sellerId, {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

// GET /analytics — financial analytics alias for this shop only
router.get(
  '/analytics',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerPaymentService.getRevenueAnalytics(sellerId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

// GET /payments/:id — single payment lookup. Returns 403 Forbidden if belonging to another store.
router.get(
  '/payments/:id',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const paymentId = req.params.id;
      const result = await SellerPaymentService.getPaymentById(sellerId, paymentId);
      return success(res, { payment: result });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
