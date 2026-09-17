import { Router, Response, NextFunction } from 'express';
import { AuthRequest, requireSeller } from '../middleware/auth';
import { success, AppError } from '../utils/response';
import { SellerPaymentService } from '../services/SellerPaymentService';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { SellerPayoutService } from '../services/SellerPayoutService';
import logger from '../config/logger';

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

// ============================================================================
// AUTHORITATIVE SELLER EARNINGS & SETTLEMENT APIS (LEDGER-BASED)
// ============================================================================

/**
 * GET /earnings/summary
 * Returns authoritative headline metrics: Today's earnings, Pending settlement,
 * Available for payout, This week's earnings, Total settled, and Next payout date.
 */
router.get(
  '/earnings/summary',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerLedgerService.getEarningsSummary(sellerId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /earnings/today
 * Detailed breakdown of today's gross sales, commission, GST, net earnings,
 * and completed orders count.
 */
router.get(
  '/earnings/today',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerLedgerService.getTodayEarnings(sellerId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /earnings/weekly
 * Returns gross sales, commission, net earnings, and day-by-day (Mon-Sun)
 * earnings breakdown for the seller.
 */
router.get(
  '/earnings/weekly',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerLedgerService.getWeeklyEarnings(sellerId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /earnings/pending
 * Returns list of orders waiting in the 24/48-hour settlement period,
 * with exact settlement date/time ("Available on: ...").
 */
router.get(
  '/earnings/pending',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerLedgerService.getPendingSettlements(sellerId);
      return success(res, { items: result });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /earnings/available
 * Returns items that have completed their settlement period and are available
 * for payout right now, along with the total available balance.
 */
router.get(
  '/earnings/available',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerLedgerService.getAvailablePayouts(sellerId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

// ============================================================================
// PAYOUT MANAGEMENT APIS
// ============================================================================

/**
 * GET /bank-account
 * Returns masked bank account info and verification status for the seller.
 */
router.get(
  '/bank-account',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerPayoutService.getBankAccount(sellerId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

/**
 * POST /payout
 * Request a payout of available funds.
 */
router.post(
  '/payout',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const requestedAmountPaise = req.body?.amountPaise
        ? Number(req.body.amountPaise)
        : undefined;

      const payout = await SellerPayoutService.requestPayout(sellerId, requestedAmountPaise);
      return success(res, { payout }, 201);
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /payouts
 * List payout history for this shop.
 */
router.get(
  '/payouts',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerPayoutService.listPayouts(sellerId, {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /payouts/:id
 * Retrieve details of a specific payout including orders included.
 */
router.get(
  '/payouts/:id',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const payout = await SellerPayoutService.getPayoutById(sellerId, req.params.id);
      return success(res, { payout });
    } catch (e) {
      next(e);
    }
  },
);

// ============================================================================
// TRANSACTION LEDGER & HISTORY
// ============================================================================

/**
 * GET /transactions
 * Paginated ledger transaction log for this shop (ORDER_EARNING, REFUND, PAYOUT, etc.).
 */
router.get(
  '/transactions',
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerLedgerService.listTransactions(sellerId, {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        status: req.query.status as string,
      });

      if (result.items && result.items.length > 0) {
        return success(res, result);
      }

      // Fallback: derive transactions from CustomerOrder payments so orders where
      // payment succeeded are always visible in transactions
      const paymentTxns = await SellerPaymentService.getTransactions(sellerId.toString(), {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      return success(res, paymentTxns);
    } catch (e) {
      next(e);
    }
  },
);

// ============================================================================
// PAYMENT WEBHOOK (IDEMPOTENT GATEWAY CALLBACK)
// ============================================================================

/**
 * POST /webhook & /payments/webhook
 * Idempotent webhook for payout and payment events from payment gateways (e.g. Razorpay).
 */
const handleWebhook = async (req: AuthRequest, res: Response) => {
  try {
    const event = req.body?.event;
    const payload = req.body?.payload;

    logger.info('Payment gateway webhook received', { event });

    if (event === 'payout.processed' || event === 'transfer.processed') {
      const payoutId = payload?.payout?.entity?.id || payload?.transfer?.entity?.id;
      if (payoutId) {
        await SellerPayoutService.finalizePayout(payoutId, true, payload?.payout?.entity?.reference_id);
      }
    } else if (event === 'payout.failed' || event === 'transfer.failed') {
      const payoutId = payload?.payout?.entity?.id || payload?.transfer?.entity?.id;
      const failureReason = payload?.payout?.entity?.failure_reason || 'Gateway transfer rejected';
      if (payoutId) {
        await SellerPayoutService.finalizePayout(payoutId, false, undefined, failureReason);
      }
    }

    return res.status(200).json({ status: 'ok', received: true });
  } catch (err) {
    logger.error('Webhook processing error', { err });
    return res.status(200).json({ status: 'error', error: (err as Error)?.message });
  }
};

router.post('/webhook', handleWebhook);
router.post('/payments/webhook', handleWebhook);

// ============================================================================
// BACKWARDS-COMPATIBLE ALIASES
// ============================================================================

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

// GET /overview & /payments/overview — unified payment overview for the seller dashboard
router.get(
  ['/overview', '/payments/overview'],
  ...sellerAuthAndGate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.user!.sellerId!;
      const result = await SellerPaymentService.getPaymentOverview(sellerId);
      return success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
