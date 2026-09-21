import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import mongoose, { Types } from 'mongoose';
import Seller from '../models/Seller';
import CustomerOrder from '../models/CustomerOrder';
import SellerLedger from '../models/SellerLedger';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { SellerPaymentService } from '../services/SellerPaymentService';

async function testReconciliation() {
  await connectDatabase();

  console.log('--- BEFORE RECONCILIATION ---');
  const sellers = await Seller.find({ _id: { $in: ['6aab79702d2c3ee2e37ba263', '6aab7bd92d2c3ee2e37ba534'] } }).lean();

  // Find all orders for these sellers
  const orders = await CustomerOrder.find({
    sellerId: { $in: sellers.map((s) => s._id) },
    paymentStatus: 'PAID',
  }).lean();

  console.log(`Found ${orders.length} paid orders across active sellers:`);
  for (const o of orders) {
    const isSettled = ['DELIVERED', 'completed'].includes(String(o.status)) ||
      ['HANDED_OVER', 'COMPLETED'].includes(String(o.fulfillmentStatus));

    console.log({
      orderId: o._id,
      orderNumber: o.orderNumber,
      sellerId: o.sellerId,
      status: o.status,
      fulfillmentStatus: o.fulfillmentStatus,
      completedAt: o.completedAt,
      isSettled,
    });

    if (isSettled) {
      console.log(`Reconciling order completion for ${o.orderNumber}...`);
      await SellerLedgerService.recordOrderCompletion(o);
    }
  }

  console.log('\n--- AFTER RECONCILING ORDERS INTO LEDGER ---');
  for (const s of sellers) {
    const sid = String(s._id);
    console.log(`\n=== SELLER ${sid} (${(s as any).storeName || (s as any).fullName}) ===`);

    const summary = await SellerLedgerService.getEarningsSummary(sid);
    console.log('Summary:', {
      todayEarningsRupees: summary.todayEarningsRupees,
      pendingSettlementRupees: summary.pendingSettlementRupees,
      availablePayoutRupees: summary.availablePayoutRupees,
      totalSettledRupees: summary.totalSettledRupees,
      thisWeekEarningsRupees: summary.thisWeekEarningsRupees,
      nextPayoutDate: summary.nextPayoutDate,
    });

    const today = await SellerLedgerService.getTodayEarnings(sid);
    console.log('Today:', {
      todayEarningsRupees: today.todayEarningsRupees,
      grossSalesRupees: today.grossSalesRupees,
      commissionRupees: today.commissionRupees,
      ordersCompletedToday: today.ordersCompletedToday,
    });

    const rev = await SellerPaymentService.getRevenueAnalytics(sid);
    console.log('Revenue Analytics:', {
      totalRevenueRupees: rev.totalRevenueRupees,
      netEarningsRupees: rev.netEarningsRupees,
      todayRevenueRupees: rev.todayRevenueRupees,
      weeklyRevenueRupees: rev.weeklyRevenueRupees,
      totalPaymentsCount: rev.totalPaymentsCount,
      completedPaymentsCount: rev.completedPaymentsCount,
      pendingPaymentsCount: rev.pendingPaymentsCount,
    });

    const setts = await SellerPaymentService.getSettlements(sid);
    console.log('Settlements:', {
      availablePayoutAmountPaise: setts.availablePayoutAmountPaise,
      pendingSettlementAmountPaise: setts.pendingSettlementAmountPaise,
      totalSettledAmountPaise: setts.totalSettledAmountPaise,
      settlementsCount: setts.settlements.length,
      statuses: setts.settlements.map((st) => ({ order: st.orderNumber, status: st.status, net: st.netEarningsPaise })),
    });
  }

  await disconnectDatabase();
}

testReconciliation().catch(console.error);
