import { Types } from 'mongoose';
import SellerPayout, { ISellerPayout } from '../models/SellerPayout';
import SellerLedger from '../models/SellerLedger';
import Seller from '../models/Seller';
import SellerStoreSettings from '../models/SellerStoreSettings';
import CustomerOrder from '../models/CustomerOrder';
import { SellerLedgerService } from './SellerLedgerService';
import logger from '../config/logger';

export interface AdminPayoutListQuery {
  page?: number;
  limit?: number;
  sellerId?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}

export class AdminSellerFinancialService {
  /**
   * List seller payouts across all sellers or a specific seller with filters & pagination.
   */
  static async listPayouts(query: AdminPayoutListQuery = {}) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};

    if (query.sellerId && Types.ObjectId.isValid(query.sellerId)) {
      filter.sellerId = new Types.ObjectId(query.sellerId);
    }

    if (query.status && query.status !== 'all') {
      filter.status = query.status.toUpperCase();
    }

    if (query.startDate || query.endDate) {
      filter.requestedAt = {};
      if (query.startDate) {
        filter.requestedAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        filter.requestedAt.$lte = end;
      }
    }

    if (query.search && query.search.trim()) {
      const searchRegex = new RegExp(query.search.trim(), 'i');
      const matchingSellers = await Seller.find({
        $or: [
          { fullName: searchRegex },
          { storeName: searchRegex },
          { mobileNumber: searchRegex },
        ],
      }).select('_id').lean();

      const matchingStores = await SellerStoreSettings.find({
        name: searchRegex,
      }).select('sellerId').lean();

      const sellerIdsFromSearch = [
        ...matchingSellers.map((s) => s._id),
        ...matchingStores.map((s) => s.sellerId),
      ];

      filter.$or = [
        { payoutId: searchRegex },
        { referenceNumber: searchRegex },
        { gatewayPayoutId: searchRegex },
        ...(sellerIdsFromSearch.length > 0 ? [{ sellerId: { $in: sellerIdsFromSearch } }] : []),
      ];
    }

    const [payouts, total] = await Promise.all([
      SellerPayout.find(filter)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SellerPayout.countDocuments(filter),
    ]);

    // Fetch seller & store information for each payout
    const sellerIds = Array.from(new Set(payouts.map((p) => p.sellerId.toString())));
    const [sellers, stores] = await Promise.all([
      Seller.find({ _id: { $in: sellerIds.map((id) => new Types.ObjectId(id)) } })
        .select('_id fullName mobileNumber email approvalStatus')
        .lean(),
      SellerStoreSettings.find({ sellerId: { $in: sellerIds.map((id) => new Types.ObjectId(id)) } })
        .select('sellerId name bankAccount')
        .lean(),
    ]);

    const sellerMap = new Map(sellers.map((s) => [s._id.toString(), s]));
    const storeMap = new Map(stores.map((s) => [s.sellerId.toString(), s]));

    const items = payouts.map((p) => {
      const sid = p.sellerId.toString();
      const seller = sellerMap.get(sid);
      const store = storeMap.get(sid);

      return {
        id: p._id.toString(),
        payoutId: p.payoutId,
        sellerId: sid,
        sellerName: seller?.fullName || (store as any)?.shopName || 'Seller',
        sellerPhone: seller?.mobileNumber || '',
        sellerEmail: seller?.email || '',
        storeName: (store as any)?.shopName || seller?.fullName || 'Store',
        amountPaise: p.amountPaise,
        amountRupees: Math.round(p.amountPaise / 100),
        status: p.status,
        bankAccount: p.bankAccount,
        referenceNumber: p.referenceNumber || null,
        gatewayPayoutId: p.gatewayPayoutId || null,
        failureReason: p.failureReason || null,
        requestedAt: p.requestedAt ? new Date(p.requestedAt).toISOString() : new Date(p.createdAt).toISOString(),
        processedAt: p.processedAt ? new Date(p.processedAt).toISOString() : null,
        settledAt: p.settledAt ? new Date(p.settledAt).toISOString() : null,
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single payout details including included order earnings/ledger items.
   */
  static async getPayoutById(payoutId: string) {
    let query: Record<string, any> = { payoutId };
    if (Types.ObjectId.isValid(payoutId)) {
      query = { $or: [{ payoutId }, { _id: new Types.ObjectId(payoutId) }] };
    }

    const payout = await SellerPayout.findOne(query).lean();
    if (!payout) {
      throw new Error('Payout record not found');
    }

    const sid = payout.sellerId.toString();
    const [seller, store, ledgers] = await Promise.all([
      Seller.findById(payout.sellerId).select('_id fullName mobileNumber email').lean(),
      SellerStoreSettings.findOne({ sellerId: payout.sellerId }).select('name bankAccount').lean(),
      payout.ledgerTransactionIds?.length
        ? SellerLedger.find({ _id: { $in: payout.ledgerTransactionIds } }).lean()
        : SellerLedger.find({ payoutId: payout.payoutId }).lean(),
    ]);

    const items = ledgers.map((l) => ({
      id: l._id.toString(),
      orderId: l.orderId ? l.orderId.toString() : '',
      orderNumber: l.orderNumber || '',
      transactionType: l.transactionType,
      grossAmountPaise: l.grossAmountPaise,
      commissionAmountPaise: l.commissionAmountPaise,
      taxOnCommissionPaise: l.taxOnCommissionPaise,
      netAmountPaise: l.netAmountPaise,
      status: l.status,
      completedAt: l.completedAt ? new Date(l.completedAt).toISOString() : '',
      settlementEligibleAt: l.settlementEligibleAt ? new Date(l.settlementEligibleAt).toISOString() : '',
    }));

    return {
      payout: {
        id: payout._id.toString(),
        payoutId: payout.payoutId,
        sellerId: sid,
        sellerName: seller?.fullName || (store as any)?.shopName || 'Seller',
        sellerPhone: seller?.mobileNumber || '',
        sellerEmail: seller?.email || '',
        storeName: (store as any)?.shopName || seller?.fullName || 'Store',
        amountPaise: payout.amountPaise,
        amountRupees: Math.round(payout.amountPaise / 100),
        status: payout.status,
        bankAccount: payout.bankAccount,
        referenceNumber: payout.referenceNumber || null,
        gatewayPayoutId: payout.gatewayPayoutId || null,
        failureReason: payout.failureReason || null,
        requestedAt: payout.requestedAt ? new Date(payout.requestedAt).toISOString() : new Date(payout.createdAt).toISOString(),
        processedAt: payout.processedAt ? new Date(payout.processedAt).toISOString() : null,
        settledAt: payout.settledAt ? new Date(payout.settledAt).toISOString() : null,
        includedTransactions: items,
      },
    };
  }

  /**
   * Get authoritative financial summary for a specific seller.
   */
  static async getSellerFinancialSummary(sellerId: string | Types.ObjectId) {
    const sid = new Types.ObjectId(sellerId);
    await SellerLedgerService.reconcileSellerLedgers(sid);

    const [summary, ledgers, payouts] = await Promise.all([
      SellerLedgerService.getEarningsSummary(sid),
      SellerLedger.find({ sellerId: sid }).lean(),
      SellerPayout.find({ sellerId: sid }).lean(),
    ]);

    let processingBalancePaise = 0;
    for (const p of payouts) {
      if (p.status === 'PROCESSING' || p.status === 'REQUESTED') {
        processingBalancePaise += p.amountPaise;
      }
    }

    const totalEarningsPaise =
      summary.totalSettledPaise + summary.pendingSettlementPaise + summary.availablePayoutPaise + processingBalancePaise;

    return {
      sellerId: sid.toString(),
      totalEarningsPaise,
      totalEarningsRupees: Math.round(totalEarningsPaise / 100),
      pendingSettlementPaise: summary.pendingSettlementPaise,
      pendingSettlementRupees: Math.round(summary.pendingSettlementPaise / 100),
      availableBalancePaise: summary.availablePayoutPaise,
      availableBalanceRupees: Math.round(summary.availablePayoutPaise / 100),
      processingBalancePaise,
      processingBalanceRupees: Math.round(processingBalancePaise / 100),
      settledAmountPaise: summary.totalSettledPaise,
      settledAmountRupees: Math.round(summary.totalSettledPaise / 100),
      currency: 'INR',
    };
  }

  /**
   * Get seller ledger/settlement history with pagination.
   */
  static async getSellerSettlements(sellerId: string | Types.ObjectId, page = 1, limit = 20) {
    const sid = new Types.ObjectId(sellerId);
    await SellerLedgerService.reconcileSellerLedgers(sid);

    const skip = (Math.max(1, page) - 1) * limit;

    const [items, total] = await Promise.all([
      SellerLedger.find({ sellerId: sid })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SellerLedger.countDocuments({ sellerId: sid }),
    ]);

    const formatted = items.map((l) => ({
      id: l._id.toString(),
      orderId: l.orderId ? l.orderId.toString() : '',
      orderNumber: l.orderNumber || '',
      transactionType: l.transactionType,
      grossAmountPaise: l.grossAmountPaise,
      commissionAmountPaise: l.commissionAmountPaise,
      taxOnCommissionPaise: l.taxOnCommissionPaise,
      netAmountPaise: l.netAmountPaise,
      status: l.status,
      completedAt: l.completedAt ? new Date(l.completedAt).toISOString() : '',
      settlementEligibleAt: l.settlementEligibleAt ? new Date(l.settlementEligibleAt).toISOString() : '',
      createdAt: new Date(l.createdAt).toISOString(),
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
