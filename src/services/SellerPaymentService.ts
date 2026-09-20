import { Types } from 'mongoose';
import CustomerOrder, { ICustomerOrder } from '../models/CustomerOrder';
import SellerLedger from '../models/SellerLedger';
import { SellerLedgerService } from './SellerLedgerService';
import { AppError } from '../utils/response';

/**
 * Fulfillment states at/after partner pickup — the seller's money is releasable.
 * `HANDED_OVER` is set when the partner scans the pickup QR; `COMPLETED` is the
 * terminal state after delivery. Both must count as settled, otherwise a fully
 * completed order's earnings flip back into "Pending Payout".
 */
const SETTLED_FULFILLMENT_STATUSES = new Set(['HANDED_OVER', 'COMPLETED']);

export interface SellerPaymentDTO {
  id: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  sellerId: string;
  customerUserId: string;
  customerName?: string;
  grossAmountPaise: number;
  itemTotalPaise: number;
  platformFeePaise: number;
  taxPaise: number;
  netAmountPaise: number;
  paymentMode: 'prepaid' | 'cod';
  paymentStatus: string;
  fulfillmentStatus?: string;
  refunds: Array<{
    amountPaise: number;
    reason: string;
    status: string;
    at: string;
    note?: string;
  }>;
  totalRefundedPaise: number;
  settlementStatus: 'settled' | 'pending' | 'refunded';
  paidAt?: string;
  createdAt: string;
}

export interface SellerRevenueAnalyticsDTO {
  sellerId: string;
  totalRevenuePaise: number;
  totalRevenueRupees: number;
  netEarningsPaise: number;
  netEarningsRupees: number;
  todayRevenuePaise: number;
  todayRevenueRupees: number;
  weeklyRevenuePaise: number;
  weeklyRevenueRupees: number;
  monthlyRevenuePaise: number;
  monthlyRevenueRupees: number;
  totalPaymentsCount: number;
  completedPaymentsCount: number;
  pendingPaymentsCount: number;
  failedPaymentsCount: number;
  refundCount: number;
  totalRefundedPaise: number;
  totalRefundedRupees: number;
  averageOrderValuePaise: number;
}

export interface SellerSettlementsDTO {
  sellerId: string;
  availablePayoutAmountPaise: number;
  pendingSettlementAmountPaise: number;
  totalSettledAmountPaise: number;
  settlements: Array<{
    orderId: string;
    orderNumber: string;
    grossAmountPaise: number;
    platformFeePaise: number;
    taxPaise: number;
    netEarningsPaise: number;
    status: 'settled' | 'pending' | 'refunded';
    date: string;
  }>;
}

export function formatSellerPayment(order: ICustomerOrder | Record<string, any>): SellerPaymentDTO {
  const itemTotalPaise = order.itemTotalPaise || order.amountPaise || 0;
  const platformFeePaise = Math.round(itemTotalPaise * 0.05); // 5% platform fee
  const taxPaise = Math.round(platformFeePaise * 0.18); // 18% GST on platform fee
  const netAmountPaise = Math.max(0, itemTotalPaise - platformFeePaise - taxPaise);

  const rawRefunds = Array.isArray(order.refunds) ? order.refunds : [];
  const refunds = rawRefunds.map((r: any) => ({
    amountPaise: r.amountPaise || 0,
    reason: r.reason || '',
    status: r.status || 'PENDING',
    at: r.at ? new Date(r.at).toISOString() : new Date().toISOString(),
    note: r.note,
  }));

  const totalRefundedPaise = refunds
    .filter((r: any) => r.status === 'ISSUED')
    .reduce((sum: number, r: any) => sum + r.amountPaise, 0);

  const settlementStatus: 'settled' | 'pending' | 'refunded' =
    totalRefundedPaise > 0
      ? 'refunded'
      : SETTLED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus)
      ? 'settled'
      : 'pending';

  const paymentId = order.razorpayPaymentId || order._id.toString();

  return {
    id: paymentId,
    paymentId,
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    sellerId: order.sellerId ? order.sellerId.toString() : '',
    customerUserId: order.userId || '',
    customerName: (order.address as any)?.name || (order as any).customerName || 'Customer',
    grossAmountPaise: order.amountPaise || 0,
    itemTotalPaise,
    platformFeePaise,
    taxPaise,
    netAmountPaise,
    paymentMode: order.razorpayPaymentId ? 'prepaid' : 'cod',
    paymentStatus: order.paymentStatus || 'PENDING',
    fulfillmentStatus: order.fulfillmentStatus,
    refunds,
    totalRefundedPaise,
    settlementStatus,
    paidAt: order.paymentStatus === 'PAID' ? (order.acceptedAt || order.createdAt)?.toISOString() : undefined,
    createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString(),
  };
}

export class SellerPaymentService {
  /**
   * Return only payments belonging to the authenticated seller's store.
   * Uses lean projections with the exact fields required by transaction history
   * and payment cards without overhead.
   */
  static async listPayments(
    sellerId: string,
    options: { page?: number; limit?: number; status?: string; paymentMode?: string } = {},
  ) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {
      sellerId: new Types.ObjectId(sellerId),
    };

    if (options.status && options.status !== 'all') {
      filter.paymentStatus = options.status.toUpperCase();
    } else {
      filter.paymentStatus = { $in: ['PAID', 'PENDING', 'FAILED'] };
    }

    if (options.paymentMode) {
      if (options.paymentMode === 'prepaid') {
        filter.razorpayPaymentId = { $exists: true, $ne: null };
      } else if (options.paymentMode === 'cod') {
        filter.razorpayPaymentId = { $in: [null, ''] };
      }
    }

    const [orders, total] = await Promise.all([
      CustomerOrder.find(filter)
        .select(
          '_id orderNumber sellerId userId amountPaise itemTotalPaise razorpayPaymentId paymentStatus fulfillmentStatus refunds address acceptedAt completedAt createdAt',
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CustomerOrder.countDocuments(filter),
    ]);

    const items = orders.map((o) => formatSellerPayment(o as any));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieve an individual payment. Verifies that the payment belongs to the
   * authenticated seller's store. If it belongs to another store -> 403 Forbidden.
   */
  static async getPaymentById(sellerId: string, paymentIdOrOrderId: string): Promise<SellerPaymentDTO> {
    const query: Record<string, any> = {};
    if (Types.ObjectId.isValid(paymentIdOrOrderId)) {
      query.$or = [
        { _id: new Types.ObjectId(paymentIdOrOrderId) },
        { razorpayPaymentId: paymentIdOrOrderId },
        { orderNumber: paymentIdOrOrderId },
      ];
    } else {
      query.$or = [
        { razorpayPaymentId: paymentIdOrOrderId },
        { orderNumber: paymentIdOrOrderId },
      ];
    }

    const order = await CustomerOrder.findOne(query)
      .select(
        '_id orderNumber sellerId userId amountPaise itemTotalPaise razorpayPaymentId paymentStatus fulfillmentStatus refunds address acceptedAt completedAt createdAt',
      )
      .lean();
    if (!order) {
      throw new AppError('Payment record not found', 404);
    }

    const orderSellerId = order.sellerId ? order.sellerId.toString() : '';
    if (orderSellerId !== sellerId.toString()) {
      throw new AppError('Forbidden: Access to another shop\'s payment is denied', 403);
    }

    return formatSellerPayment(order as any);
  }

  /**
   * Aggregates revenue strictly for the authenticated seller's store.
   * Calculations never include other shops' payments.
   */
  static async getRevenueAnalytics(sellerId: string): Promise<SellerRevenueAnalyticsDTO> {
    const sid = new Types.ObjectId(sellerId);
    const ledgerCount = await SellerLedger.countDocuments({ sellerId: sid });

    if (ledgerCount > 0) {
      const summary = await SellerLedgerService.getEarningsSummary(sid);
      const [today, weekly] = await Promise.all([
        SellerLedgerService.getTodayEarnings(sid),
        SellerLedgerService.getWeeklyEarnings(sid, summary),
      ]);

      const netEarningsPaise =
        summary.totalSettledPaise + summary.pendingSettlementPaise + summary.availablePayoutPaise;

      return {
        sellerId,
        totalRevenuePaise: weekly.grossSalesPaise || today.grossSalesPaise || netEarningsPaise,
        totalRevenueRupees: Math.round(
          (weekly.grossSalesPaise || today.grossSalesPaise || netEarningsPaise) / 100,
        ),
        netEarningsPaise,
        netEarningsRupees: Math.round(netEarningsPaise / 100),
        todayRevenuePaise: today.todayEarningsPaise,
        todayRevenueRupees: today.todayEarningsRupees,
        weeklyRevenuePaise: weekly.netEarningsPaise,
        weeklyRevenueRupees: weekly.netEarningsRupees,
        monthlyRevenuePaise: weekly.grossSalesPaise || netEarningsPaise,
        monthlyRevenueRupees: Math.round((weekly.grossSalesPaise || netEarningsPaise) / 100),
        totalPaymentsCount: today.ordersCompletedToday,
        completedPaymentsCount: today.ordersCompletedToday,
        pendingPaymentsCount: summary.pendingSettlementPaise > 0 ? 1 : 0,
        failedPaymentsCount: 0,
        refundCount: 0,
        totalRefundedPaise: 0,
        totalRefundedRupees: 0,
        averageOrderValuePaise: 0,
      };
    }

    const orders = await CustomerOrder.find({
      sellerId: sid,
    })
      .select('amountPaise itemTotalPaise paymentStatus refunds createdAt')
      .lean();

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let totalRevenuePaise = 0;
    let netEarningsPaise = 0;
    let todayRevenuePaise = 0;
    let weeklyRevenuePaise = 0;
    let monthlyRevenuePaise = 0;
    let totalPaymentsCount = orders.length;
    let completedPaymentsCount = 0;
    let pendingPaymentsCount = 0;
    let failedPaymentsCount = 0;
    let refundCount = 0;
    let totalRefundedPaise = 0;

    for (const order of orders) {
      const isPaid = order.paymentStatus === 'PAID';
      const orderDate = new Date(order.createdAt);
      const grossPaise = order.amountPaise || 0;
      const itemTotalPaise = order.itemTotalPaise || grossPaise;
      const feePaise = Math.round(itemTotalPaise * 0.05);
      const taxPaise = Math.round(feePaise * 0.18);
      const netPaise = Math.max(0, itemTotalPaise - feePaise - taxPaise);

      if (isPaid) {
        completedPaymentsCount += 1;
        totalRevenuePaise += grossPaise;
        netEarningsPaise += netPaise;

        if (orderDate >= startOfToday) {
          todayRevenuePaise += grossPaise;
        }
        if (orderDate >= sevenDaysAgo) {
          weeklyRevenuePaise += grossPaise;
        }
        if (orderDate >= thirtyDaysAgo) {
          monthlyRevenuePaise += grossPaise;
        }
      } else if (order.paymentStatus === 'PENDING') {
        pendingPaymentsCount += 1;
      } else if (order.paymentStatus === 'FAILED') {
        failedPaymentsCount += 1;
      }

      if (Array.isArray(order.refunds) && order.refunds.length > 0) {
        const issuedRefunds = order.refunds.filter((r) => r.status === 'ISSUED');
        if (issuedRefunds.length > 0) {
          refundCount += 1;
          for (const r of issuedRefunds) {
            totalRefundedPaise += r.amountPaise || 0;
          }
        }
      }
    }

    const averageOrderValuePaise =
      completedPaymentsCount > 0 ? Math.round(totalRevenuePaise / completedPaymentsCount) : 0;

    return {
      sellerId,
      totalRevenuePaise,
      totalRevenueRupees: Math.round(totalRevenuePaise / 100),
      netEarningsPaise,
      netEarningsRupees: Math.round(netEarningsPaise / 100),
      todayRevenuePaise,
      todayRevenueRupees: Math.round(todayRevenuePaise / 100),
      weeklyRevenuePaise,
      weeklyRevenueRupees: Math.round(weeklyRevenuePaise / 100),
      monthlyRevenuePaise,
      monthlyRevenueRupees: Math.round(monthlyRevenuePaise / 100),
      totalPaymentsCount,
      completedPaymentsCount,
      pendingPaymentsCount,
      failedPaymentsCount,
      refundCount,
      totalRefundedPaise,
      totalRefundedRupees: Math.round(totalRefundedPaise / 100),
      averageOrderValuePaise,
    };
  }

  /**
   * Return settlement and payout balances strictly for the authenticated seller's store.
   * Includes orders in PENDING_ORDER_COMPLETION so the shopkeeper sees incoming payments
   * while the order is fulfilling and before the 48h settlement timer begins.
   */
  static async getSettlements(sellerId: string): Promise<SellerSettlementsDTO> {
    const sid = new Types.ObjectId(sellerId);
    const ledgerCount = await SellerLedger.countDocuments({ sellerId: sid });

    if (ledgerCount > 0) {
      const [summary, pendingList, availableList, inProgressList] = await Promise.all([
        SellerLedgerService.getEarningsSummary(sid),
        SellerLedgerService.getPendingSettlements(sid),
        SellerLedgerService.getAvailablePayouts(sid),
        SellerLedger.find({
          sellerId: sid,
          status: 'PENDING_ORDER_COMPLETION',
        })
          .sort({ createdAt: -1 })
          .lean(),
      ]);

      const settlements: SellerSettlementsDTO['settlements'] = [];

      for (const item of availableList.items) {
        settlements.push({
          orderId: item.orderId,
          orderNumber: item.orderNumber,
          grossAmountPaise: item.grossAmountPaise,
          platformFeePaise: 0,
          taxPaise: 0,
          netEarningsPaise: item.netAmountPaise,
          status: 'settled',
          date: item.completedAt,
        });
      }

      for (const item of pendingList) {
        settlements.push({
          orderId: item.orderId,
          orderNumber: item.orderNumber,
          grossAmountPaise: item.grossAmountPaise,
          platformFeePaise: item.commissionPaise,
          taxPaise: 0,
          netEarningsPaise: item.sellerEarningsPaise,
          status: 'pending',
          date: item.completedAt,
        });
      }

      // Include paid orders currently fulfilling (pre-completion) in the activity stream
      for (const item of inProgressList) {
        settlements.push({
          orderId: item.orderId ? item.orderId.toString() : '',
          orderNumber: item.orderNumber || 'EH-ORDER',
          grossAmountPaise: item.grossAmountPaise,
          platformFeePaise: item.commissionAmountPaise,
          taxPaise: item.taxOnCommissionPaise,
          netEarningsPaise: item.netAmountPaise,
          status: 'pending',
          date: item.paidAt ? item.paidAt.toISOString() : item.createdAt.toISOString(),
        });
      }

      return {
        sellerId,
        availablePayoutAmountPaise: summary.availablePayoutPaise,
        pendingSettlementAmountPaise: summary.pendingSettlementPaise,
        totalSettledAmountPaise: summary.totalSettledPaise,
        settlements,
      };
    }

    const orders = await CustomerOrder.find({
      sellerId: sid,
      paymentStatus: 'PAID',
    })
      .select('_id orderNumber amountPaise itemTotalPaise fulfillmentStatus refunds createdAt')
      .sort({ createdAt: -1 })
      .lean();

    let availablePayoutAmountPaise = 0;
    let pendingSettlementAmountPaise = 0;
    let totalSettledAmountPaise = 0;

    const settlements: SellerSettlementsDTO['settlements'] = [];

    for (const order of orders) {
      const itemTotalPaise = order.itemTotalPaise || order.amountPaise || 0;
      const platformFeePaise = Math.round(itemTotalPaise * 0.05);
      const taxPaise = Math.round(platformFeePaise * 0.18);
      const netEarningsPaise = Math.max(0, itemTotalPaise - platformFeePaise - taxPaise);

      const isRefunded = (order.refunds || []).some((r) => r.status === 'ISSUED');
      const isSettled = SETTLED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus ?? '');

      let status: 'settled' | 'pending' | 'refunded' = 'pending';
      if (isRefunded) {
        status = 'refunded';
      } else if (isSettled) {
        status = 'settled';
        availablePayoutAmountPaise += netEarningsPaise;
        totalSettledAmountPaise += netEarningsPaise;
      } else {
        pendingSettlementAmountPaise += netEarningsPaise;
      }

      settlements.push({
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        grossAmountPaise: order.amountPaise || 0,
        platformFeePaise,
        taxPaise,
        netEarningsPaise,
        status,
        date: order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString(),
      });
    }

    return {
      sellerId,
      availablePayoutAmountPaise,
      pendingSettlementAmountPaise,
      totalSettledAmountPaise,
      settlements,
    };
  }

  /**
   * Return transaction ledger entries strictly for the authenticated seller's store.
   */
  static async getTransactions(
    sellerId: string,
    options: { page?: number; limit?: number } = {},
  ) {
    const paymentsResult = await this.listPayments(sellerId, options);
    const transactions = paymentsResult.items.map((p) => ({
      id: p.id,
      transactionId: `txn_${p.id}`,
      paymentId: p.paymentId,
      orderId: p.orderId,
      orderNumber: p.orderNumber,
      customerName: p.customerName || 'Customer',
      transactionType: p.totalRefundedPaise > 0 ? 'REFUND' : 'ORDER_EARNING',
      type: p.totalRefundedPaise > 0 ? 'REFUND' : 'PAYMENT',
      grossAmountPaise: p.grossAmountPaise,
      amountPaise: p.grossAmountPaise,
      netAmountPaise: p.netAmountPaise,
      status: p.paymentStatus,
      date: p.paidAt || p.createdAt,
      createdAt: p.createdAt,
    }));

    return {
      items: transactions,
      total: paymentsResult.total,
      page: paymentsResult.page,
      limit: paymentsResult.limit,
      totalPages: paymentsResult.totalPages,
    };
  }

  /**
   * Return payment overview uniting revenue metrics, settlement breakdown,
   * and recent transactions for the shop.
   */
  static async getPaymentOverview(sellerId: string) {
    const [analytics, settlements, recentTransactions] = await Promise.all([
      this.getRevenueAnalytics(sellerId),
      this.getSettlements(sellerId),
      this.getTransactions(sellerId, { limit: 10 }),
    ]);

    return {
      ...analytics,
      ...settlements,
      recentTransactions: recentTransactions.items,
    };
  }
}
