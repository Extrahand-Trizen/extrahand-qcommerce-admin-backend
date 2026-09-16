import { Types } from 'mongoose';
import SellerLedger, { ISellerLedger } from '../models/SellerLedger';
import CustomerOrder, { ICustomerOrder } from '../models/CustomerOrder';
import {
  SELLER_SETTLEMENT_CONFIG,
  calculateSellerOrderEarnings,
} from '../config/sellerSettlement';
import logger from '../config/logger';
import { emitOrderUpdated } from '../socket/orderSocket';

export interface EarningsSummaryDTO {
  todayEarningsPaise: number;
  todayEarningsRupees: number;
  pendingSettlementPaise: number;
  pendingSettlementRupees: number;
  availablePayoutPaise: number;
  availablePayoutRupees: number;
  thisWeekEarningsPaise: number;
  thisWeekEarningsRupees: number;
  totalSettledPaise: number;
  totalSettledRupees: number;
  nextPayoutDate: string | null;
  settlementHours: number;
}

export interface TodayEarningsDTO {
  todayEarningsPaise: number;
  todayEarningsRupees: number;
  grossSalesPaise: number;
  grossSalesRupees: number;
  commissionPaise: number;
  commissionRupees: number;
  taxOnCommissionPaise: number;
  ordersCompletedToday: number;
}

export interface DailyEarningsBreakdownDTO {
  date: string;
  dayName: string;
  grossSalesPaise: number;
  commissionPaise: number;
  netEarningsPaise: number;
  ordersCount: number;
}

export interface WeeklyEarningsDTO {
  grossSalesPaise: number;
  grossSalesRupees: number;
  commissionPaise: number;
  commissionRupees: number;
  netEarningsPaise: number;
  netEarningsRupees: number;
  pendingSettlementPaise: number;
  availablePayoutPaise: number;
  totalSettledPaise: number;
  dailyBreakdown: DailyEarningsBreakdownDTO[];
}

export interface PendingSettlementItemDTO {
  id: string;
  orderId: string;
  orderNumber: string;
  sellerEarningsPaise: number;
  grossAmountPaise: number;
  commissionPaise: number;
  completedAt: string;
  settlementEligibleAt: string;
  status: string;
  orderDate: string;
}

export interface AvailablePayoutItemDTO {
  id: string;
  orderId: string;
  orderNumber: string;
  netAmountPaise: number;
  grossAmountPaise: number;
  completedAt: string;
  settledEligibleAt: string;
  status: string;
}

export interface LedgerTransactionDTO {
  id: string;
  orderId?: string;
  orderNumber?: string;
  transactionType: string;
  grossAmountPaise: number;
  commissionAmountPaise: number;
  taxOnCommissionPaise: number;
  adjustmentAmountPaise: number;
  netAmountPaise: number;
  status: string;
  paymentId?: string;
  payoutId?: string;
  paidAt?: string;
  completedAt?: string;
  settlementEligibleAt?: string;
  settledAt?: string;
  date?: string;
  createdAt: string;
}

export class SellerLedgerService {
  /**
   * Record customer payment immediately upon successful customer payment.
   * State: PENDING_ORDER_COMPLETION.
   * Visible in payment history as "Payment Received — Pending Order Completion".
   */
  static async recordCustomerPayment(order: ICustomerOrder | any): Promise<ISellerLedger> {
    if (!order.sellerId) {
      throw new Error('Cannot record payment without sellerId');
    }

    const sellerId = new Types.ObjectId(order.sellerId);
    const orderId = new Types.ObjectId(order._id);
    const itemTotalPaise = order.itemTotalPaise || order.amountPaise || 0;

    const { grossPaise, commissionPaise, gstPaise, netEarningsPaise } =
      calculateSellerOrderEarnings(itemTotalPaise);

    const existing = await SellerLedger.findOne({
      sellerId,
      orderId,
      transactionType: 'ORDER_EARNING',
    });

    if (existing) {
      existing.grossAmountPaise = grossPaise;
      existing.commissionAmountPaise = commissionPaise;
      existing.taxOnCommissionPaise = gstPaise;
      existing.netAmountPaise = netEarningsPaise;
      existing.paymentId = order.razorpayPaymentId || order._id.toString();
      existing.paidAt = new Date();
      await existing.save();
      return existing;
    }

    const ledger = await SellerLedger.create({
      sellerId,
      orderId,
      orderNumber: order.orderNumber,
      transactionType: 'ORDER_EARNING',
      grossAmountPaise: grossPaise,
      commissionAmountPaise: commissionPaise,
      taxOnCommissionPaise: gstPaise,
      adjustmentAmountPaise: 0,
      netAmountPaise: netEarningsPaise,
      status: 'PENDING_ORDER_COMPLETION',
      paymentId: order.razorpayPaymentId || order._id.toString(),
      paidAt: new Date(),
    });

    logger.info('SellerLedger: Customer payment recorded immediately', {
      orderId: orderId.toString(),
      sellerId: sellerId.toString(),
      netEarningsPaise,
    });

    return ledger;
  }

  /**
   * Called when an order reaches final completion / delivery (COMPLETED).
   * Calculates final seller earning, transitions ledger status to PENDING_SETTLEMENT,
   * and stamps settlementEligibleAt = completedAt + SELLER_SETTLEMENT_HOURS.
   */
  static async recordOrderCompletion(order: ICustomerOrder | any): Promise<ISellerLedger> {
    if (!order.sellerId) {
      throw new Error('Cannot record completion without sellerId');
    }

    const sellerId = new Types.ObjectId(order.sellerId);
    const orderId = new Types.ObjectId(order._id);
    const completedAt = order.completedAt ? new Date(order.completedAt) : new Date();

    const settlementHours = SELLER_SETTLEMENT_CONFIG.SETTLEMENT_HOURS;
    const settlementEligibleAt = new Date(
      completedAt.getTime() + settlementHours * 3600 * 1000,
    );

    let ledger = await SellerLedger.findOne({
      sellerId,
      orderId,
      transactionType: 'ORDER_EARNING',
    });

    if (!ledger) {
      const itemTotalPaise = order.itemTotalPaise || order.amountPaise || 0;
      const { grossPaise, commissionPaise, gstPaise, netEarningsPaise } =
        calculateSellerOrderEarnings(itemTotalPaise);

      ledger = new SellerLedger({
        sellerId,
        orderId,
        orderNumber: order.orderNumber,
        transactionType: 'ORDER_EARNING',
        grossAmountPaise: grossPaise,
        commissionAmountPaise: commissionPaise,
        taxOnCommissionPaise: gstPaise,
        adjustmentAmountPaise: 0,
        netAmountPaise: netEarningsPaise,
        paymentId: order.razorpayPaymentId || order._id.toString(),
        paidAt: order.paidAt || completedAt,
      });
    }

    // Only update if not already settled or available
    if (
      ledger.status === 'PENDING_ORDER_COMPLETION' ||
      ledger.status === 'PENDING_SETTLEMENT'
    ) {
      ledger.status = 'PENDING_SETTLEMENT';
      ledger.completedAt = completedAt;
      ledger.settlementEligibleAt = settlementEligibleAt;
      await ledger.save();

      logger.info('SellerLedger: Order completion earning created/updated', {
        orderId: orderId.toString(),
        sellerId: sellerId.toString(),
        netAmountPaise: ledger.netAmountPaise,
        settlementEligibleAt: settlementEligibleAt.toISOString(),
      });
    }

    return ledger;
  }

  /**
   * Handle order cancellations and refunds.
   * If pre-completion: cancel the provisional earning.
   * If pending settlement: create CANCELLATION_ADJUSTMENT and cancel pending.
   * If already settled: create negative CANCELLATION_ADJUSTMENT against seller account.
   */
  static async recordCancellationOrRefund(
    orderId: Types.ObjectId | string,
    reason: string,
    refundAmountPaise?: number,
  ) {
    const oid = new Types.ObjectId(orderId);
    const existing = await SellerLedger.findOne({
      orderId: oid,
      transactionType: 'ORDER_EARNING',
    });

    if (!existing) return;

    if (existing.status === 'PENDING_ORDER_COMPLETION') {
      existing.status = 'REFUNDED';
      existing.failureReason = reason;
      await existing.save();
      logger.info('SellerLedger: Pending order cancelled, earning voided', { orderId: String(oid) });
      return;
    }

    if (existing.status === 'PENDING_SETTLEMENT') {
      existing.status = 'ADJUSTED';
      existing.failureReason = reason;
      await existing.save();

      await SellerLedger.create({
        sellerId: existing.sellerId,
        orderId: oid,
        orderNumber: existing.orderNumber,
        transactionType: 'CANCELLATION_ADJUSTMENT',
        grossAmountPaise: existing.grossAmountPaise,
        commissionAmountPaise: 0,
        taxOnCommissionPaise: 0,
        adjustmentAmountPaise: -existing.netAmountPaise,
        netAmountPaise: -existing.netAmountPaise,
        status: 'ADJUSTED',
        failureReason: reason,
        completedAt: new Date(),
      });

      logger.info('SellerLedger: Pending settlement order refunded, adjustment recorded', {
        orderId: String(oid),
        amount: -existing.netAmountPaise,
      });
      return;
    }

    if (existing.status === 'SETTLED' || existing.status === 'AVAILABLE') {
      const deduction = refundAmountPaise
        ? calculateSellerOrderEarnings(refundAmountPaise).netEarningsPaise
        : existing.netAmountPaise;

      await SellerLedger.create({
        sellerId: existing.sellerId,
        orderId: oid,
        orderNumber: existing.orderNumber,
        transactionType: 'CANCELLATION_ADJUSTMENT',
        grossAmountPaise: refundAmountPaise || existing.grossAmountPaise,
        commissionAmountPaise: 0,
        taxOnCommissionPaise: 0,
        adjustmentAmountPaise: -deduction,
        netAmountPaise: -deduction,
        status: 'ADJUSTED',
        failureReason: reason,
        completedAt: new Date(),
      });

      logger.info('SellerLedger: Settled order refunded, debit adjustment created', {
        orderId: String(oid),
        amount: -deduction,
      });
    }
  }

  /**
   * Aggregate headline summary metrics for the authenticated seller.
   */
  static async getEarningsSummary(sellerId: Types.ObjectId | string): Promise<EarningsSummaryDTO> {
    const sid = new Types.ObjectId(sellerId);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const ledgers = await SellerLedger.find({ sellerId: sid }).lean();

    let todayEarningsPaise = 0;
    let pendingSettlementPaise = 0;
    let availablePayoutPaise = 0;
    let thisWeekEarningsPaise = 0;
    let totalSettledPaise = 0;
    let earliestPendingEligibleDate: Date | null = null;

    for (const item of ledgers) {
      const net = item.netAmountPaise || 0;
      const completedAt = item.completedAt ? new Date(item.completedAt) : null;

      if (item.status === 'PENDING_SETTLEMENT') {
        pendingSettlementPaise += net;
        if (item.settlementEligibleAt) {
          const eligibleDate = new Date(item.settlementEligibleAt);
          if (!earliestPendingEligibleDate || eligibleDate < earliestPendingEligibleDate) {
            earliestPendingEligibleDate = eligibleDate;
          }
        }
      } else if (item.status === 'AVAILABLE') {
        availablePayoutPaise += net;
      } else if (item.status === 'SETTLED') {
        totalSettledPaise += net;
      }

      // Today's earnings from completed / valid orders
      if (completedAt && completedAt >= startOfToday && item.status !== 'REFUNDED' && item.status !== 'ADJUSTED') {
        todayEarningsPaise += net;
      }

      // This week's earnings
      if (completedAt && completedAt >= sevenDaysAgo && item.status !== 'REFUNDED' && item.status !== 'ADJUSTED') {
        thisWeekEarningsPaise += net;
      }
    }

    return {
      todayEarningsPaise,
      todayEarningsRupees: Math.round(todayEarningsPaise / 100),
      pendingSettlementPaise,
      pendingSettlementRupees: Math.round(pendingSettlementPaise / 100),
      availablePayoutPaise: Math.max(0, availablePayoutPaise),
      availablePayoutRupees: Math.round(Math.max(0, availablePayoutPaise) / 100),
      thisWeekEarningsPaise,
      thisWeekEarningsRupees: Math.round(thisWeekEarningsPaise / 100),
      totalSettledPaise,
      totalSettledRupees: Math.round(totalSettledPaise / 100),
      nextPayoutDate: earliestPendingEligibleDate
        ? earliestPendingEligibleDate.toISOString()
        : null,
      settlementHours: SELLER_SETTLEMENT_CONFIG.SETTLEMENT_HOURS,
    };
  }

  /**
   * Detail breakdown of today's earnings.
   */
  static async getTodayEarnings(sellerId: Types.ObjectId | string): Promise<TodayEarningsDTO> {
    const sid = new Types.ObjectId(sellerId);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const items = await SellerLedger.find({
      sellerId: sid,
      completedAt: { $gte: startOfToday },
      status: { $in: ['PENDING_SETTLEMENT', 'AVAILABLE', 'PAYOUT_PROCESSING', 'SETTLED'] },
    }).lean();

    let todayEarningsPaise = 0;
    let grossSalesPaise = 0;
    let commissionPaise = 0;
    let taxOnCommissionPaise = 0;
    let ordersCompletedToday = 0;

    for (const item of items) {
      if (item.transactionType === 'ORDER_EARNING') {
        todayEarningsPaise += item.netAmountPaise;
        grossSalesPaise += item.grossAmountPaise;
        commissionPaise += item.commissionAmountPaise;
        taxOnCommissionPaise += item.taxOnCommissionPaise;
        ordersCompletedToday += 1;
      } else if (item.transactionType === 'CANCELLATION_ADJUSTMENT') {
        todayEarningsPaise += item.netAmountPaise;
      }
    }

    return {
      todayEarningsPaise,
      todayEarningsRupees: Math.round(todayEarningsPaise / 100),
      grossSalesPaise,
      grossSalesRupees: Math.round(grossSalesPaise / 100),
      commissionPaise,
      commissionRupees: Math.round(commissionPaise / 100),
      taxOnCommissionPaise,
      ordersCompletedToday,
    };
  }

  /**
   * Weekly earnings breakdown by day (Mon-Sun).
   */
  static async getWeeklyEarnings(
    sellerId: Types.ObjectId | string,
    existingSummary?: EarningsSummaryDTO,
  ): Promise<WeeklyEarningsDTO> {
    const sid = new Types.ObjectId(sellerId);
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 is Sun, 1 is Mon
    const distanceToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - distanceToMonday);
    monday.setHours(0, 0, 0, 0);

    const items = await SellerLedger.find({
      sellerId: sid,
      completedAt: { $gte: monday },
      status: { $in: ['PENDING_SETTLEMENT', 'AVAILABLE', 'PAYOUT_PROCESSING', 'SETTLED', 'ADJUSTED'] },
    }).lean();

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dailyMap = new Map<string, DailyEarningsBreakdownDTO>();

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
      const isoKey = d.toISOString().split('T')[0];
      dailyMap.set(isoKey, {
        date: isoKey,
        dayName: days[i],
        grossSalesPaise: 0,
        commissionPaise: 0,
        netEarningsPaise: 0,
        ordersCount: 0,
      });
    }

    let grossSalesPaise = 0;
    let commissionPaise = 0;
    let netEarningsPaise = 0;

    for (const item of items) {
      if (!item.completedAt) continue;
      const isoKey = new Date(item.completedAt).toISOString().split('T')[0];
      const dayData = dailyMap.get(isoKey);
      if (!dayData) continue;

      if (item.transactionType === 'ORDER_EARNING') {
        dayData.grossSalesPaise += item.grossAmountPaise;
        dayData.commissionPaise += item.commissionAmountPaise;
        dayData.netEarningsPaise += item.netAmountPaise;
        dayData.ordersCount += 1;

        grossSalesPaise += item.grossAmountPaise;
        commissionPaise += item.commissionAmountPaise;
        netEarningsPaise += item.netAmountPaise;
      } else if (item.transactionType === 'CANCELLATION_ADJUSTMENT') {
        dayData.netEarningsPaise += item.netAmountPaise;
        netEarningsPaise += item.netAmountPaise;
      }
    }

    const summary = existingSummary ?? (await this.getEarningsSummary(sellerId));

    return {
      grossSalesPaise,
      grossSalesRupees: Math.round(grossSalesPaise / 100),
      commissionPaise,
      commissionRupees: Math.round(commissionPaise / 100),
      netEarningsPaise,
      netEarningsRupees: Math.round(netEarningsPaise / 100),
      pendingSettlementPaise: summary.pendingSettlementPaise,
      availablePayoutPaise: summary.availablePayoutPaise,
      totalSettledPaise: summary.totalSettledPaise,
      dailyBreakdown: Array.from(dailyMap.values()),
    };
  }

  /**
   * Pending settlement orders list with settlement date/time for the seller app.
   */
  static async getPendingSettlements(
    sellerId: Types.ObjectId | string,
  ): Promise<PendingSettlementItemDTO[]> {
    const sid = new Types.ObjectId(sellerId);
    const items = await SellerLedger.find({
      sellerId: sid,
      status: 'PENDING_SETTLEMENT',
    })
      .sort({ settlementEligibleAt: 1 })
      .lean();

    return items.map((i) => ({
      id: i._id.toString(),
      orderId: i.orderId ? i.orderId.toString() : '',
      orderNumber: i.orderNumber || 'EH-ORDER',
      sellerEarningsPaise: i.netAmountPaise,
      grossAmountPaise: i.grossAmountPaise,
      commissionPaise: i.commissionAmountPaise,
      completedAt: i.completedAt ? i.completedAt.toISOString() : i.createdAt.toISOString(),
      settlementEligibleAt: i.settlementEligibleAt
        ? i.settlementEligibleAt.toISOString()
        : new Date(Date.now() + 48 * 3600000).toISOString(),
      status: 'Pending Settlement',
      orderDate: i.paidAt ? i.paidAt.toISOString() : i.createdAt.toISOString(),
    }));
  }

  /**
   * Available for payout items list.
   */
  static async getAvailablePayouts(
    sellerId: Types.ObjectId | string,
  ): Promise<{ items: AvailablePayoutItemDTO[]; totalAvailablePaise: number }> {
    const sid = new Types.ObjectId(sellerId);
    const items = await SellerLedger.find({
      sellerId: sid,
      status: 'AVAILABLE',
    })
      .sort({ completedAt: -1 })
      .lean();

    const totalAvailablePaise = items.reduce((sum, i) => sum + i.netAmountPaise, 0);

    return {
      items: items.map((i) => ({
        id: i._id.toString(),
        orderId: i.orderId ? i.orderId.toString() : '',
        orderNumber: i.orderNumber || 'EH-ORDER',
        netAmountPaise: i.netAmountPaise,
        grossAmountPaise: i.grossAmountPaise,
        completedAt: i.completedAt ? i.completedAt.toISOString() : i.createdAt.toISOString(),
        settledEligibleAt: i.settlementEligibleAt ? i.settlementEligibleAt.toISOString() : '',
        status: 'Available',
      })),
      totalAvailablePaise: Math.max(0, totalAvailablePaise),
    };
  }

  /**
   * Paginated ledger transaction log for the shop.
   */
  static async listTransactions(
    sellerId: Types.ObjectId | string,
    options: { page?: number; limit?: number; status?: string } = {},
  ) {
    const sid = new Types.ObjectId(sellerId);
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { sellerId: sid };
    if (options.status && options.status !== 'ALL') {
      filter.status = options.status;
    }

    const [items, total] = await Promise.all([
      SellerLedger.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SellerLedger.countDocuments(filter),
    ]);

    const formatted: LedgerTransactionDTO[] = items.map((i) => ({
      id: i._id.toString(),
      orderId: i.orderId?.toString(),
      orderNumber: i.orderNumber,
      transactionType: i.transactionType,
      grossAmountPaise: i.grossAmountPaise,
      commissionAmountPaise: i.commissionAmountPaise,
      taxOnCommissionPaise: i.taxOnCommissionPaise,
      adjustmentAmountPaise: i.adjustmentAmountPaise,
      netAmountPaise: i.netAmountPaise,
      status: i.status,
      paymentId: i.paymentId,
      payoutId: i.payoutId,
      paidAt: i.paidAt?.toISOString(),
      completedAt: i.completedAt?.toISOString(),
      settlementEligibleAt: i.settlementEligibleAt?.toISOString(),
      settledAt: i.settledAt?.toISOString(),
      date: i.paidAt ? i.paidAt.toISOString() : i.createdAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));

    return {
      items: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
