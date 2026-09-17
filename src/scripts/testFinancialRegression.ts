import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import mongoose, { Types } from 'mongoose';
import Seller from '../models/Seller';
import SellerLedger from '../models/SellerLedger';
import CustomerOrder from '../models/CustomerOrder';
import { SellerPaymentService } from '../services/SellerPaymentService';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { calculateSellerOrderEarnings, SELLER_SETTLEMENT_CONFIG } from '../config/sellerSettlement';
import assert from 'node:assert';

// Old sequential calculation logic before optimization
async function legacyGetRevenueAnalytics(sellerId: string) {
  const sid = new Types.ObjectId(sellerId);
  const ledgerCount = await SellerLedger.countDocuments({ sellerId: sid });

  if (ledgerCount > 0) {
    const summary = await SellerLedgerService.getEarningsSummary(sid);
    const today = await SellerLedgerService.getTodayEarnings(sid);
    // Legacy getWeeklyEarnings called getEarningsSummary internally
    const weekly = await SellerLedgerService.getWeeklyEarnings(sid);

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
  return null;
}

async function legacyGetSettlements(sellerId: string) {
  const sid = new Types.ObjectId(sellerId);
  const summary = await SellerLedgerService.getEarningsSummary(sid);
  const pendingList = await SellerLedgerService.getPendingSettlements(sid);
  const availableList = await SellerLedgerService.getAvailablePayouts(sid);
  const inProgressList = await SellerLedger.find({
    sellerId: sid,
    status: 'PENDING_ORDER_COMPLETION',
  })
    .sort({ createdAt: -1 })
    .lean();

  const settlements: any[] = [];
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

async function runFinancialTests() {
  await connectDatabase();
  console.log('================================================================');
  console.log('       FINANCIAL REGRESSION & STRICT EQUALITY VERIFICATION      ');
  console.log('================================================================');

  const testSellerId = new Types.ObjectId().toString();
  const createdLedgerIds: Types.ObjectId[] = [];

  try {
    const now = new Date();
    // Create realistic ledgers across states:
    // 1. In-progress order (pre-completion)
    const l1 = await SellerLedger.create({
      sellerId: new Types.ObjectId(testSellerId),
      orderId: new Types.ObjectId(),
      orderNumber: 'TEST-ORD-101',
      transactionType: 'ORDER_EARNING',
      grossAmountPaise: 10000,
      commissionAmountPaise: 500,
      taxOnCommissionPaise: 90,
      adjustmentAmountPaise: 0,
      netAmountPaise: 9410,
      status: 'PENDING_ORDER_COMPLETION',
      paidAt: now,
    });
    createdLedgerIds.push(l1._id);

    // 2. Pending settlement order (completed today, eligible in 48h)
    const l2 = await SellerLedger.create({
      sellerId: new Types.ObjectId(testSellerId),
      orderId: new Types.ObjectId(),
      orderNumber: 'TEST-ORD-102',
      transactionType: 'ORDER_EARNING',
      grossAmountPaise: 20000,
      commissionAmountPaise: 1000,
      taxOnCommissionPaise: 180,
      adjustmentAmountPaise: 0,
      netAmountPaise: 18820,
      status: 'PENDING_SETTLEMENT',
      completedAt: now,
      settlementEligibleAt: new Date(now.getTime() + 48 * 3600000),
      paidAt: now,
    });
    createdLedgerIds.push(l2._id);

    // 3. Available for payout order (completed 3 days ago, eligible 1 day ago)
    const l3 = await SellerLedger.create({
      sellerId: new Types.ObjectId(testSellerId),
      orderId: new Types.ObjectId(),
      orderNumber: 'TEST-ORD-103',
      transactionType: 'ORDER_EARNING',
      grossAmountPaise: 30000,
      commissionAmountPaise: 1500,
      taxOnCommissionPaise: 270,
      adjustmentAmountPaise: 0,
      netAmountPaise: 28230,
      status: 'AVAILABLE',
      completedAt: new Date(now.getTime() - 72 * 3600000),
      settlementEligibleAt: new Date(now.getTime() - 24 * 3600000),
      paidAt: new Date(now.getTime() - 72 * 3600000),
    });
    createdLedgerIds.push(l3._id);

    // 4. Settled order (already paid out)
    const l4 = await SellerLedger.create({
      sellerId: new Types.ObjectId(testSellerId),
      orderId: new Types.ObjectId(),
      orderNumber: 'TEST-ORD-104',
      transactionType: 'ORDER_EARNING',
      grossAmountPaise: 50000,
      commissionAmountPaise: 2500,
      taxOnCommissionPaise: 450,
      adjustmentAmountPaise: 0,
      netAmountPaise: 47050,
      status: 'SETTLED',
      completedAt: new Date(now.getTime() - 120 * 3600000),
      settlementEligibleAt: new Date(now.getTime() - 72 * 3600000),
      paidAt: new Date(now.getTime() - 120 * 3600000),
      settledAt: new Date(now.getTime() - 48 * 3600000),
    });
    createdLedgerIds.push(l4._id);

    console.log('Comparing Revenue Analytics (Legacy vs Optimized)...');
    const legacyRev = await legacyGetRevenueAnalytics(testSellerId);
    const newRev = await SellerPaymentService.getRevenueAnalytics(testSellerId);

    console.log('Legacy Revenue:', JSON.stringify(legacyRev, null, 2));
    console.log('New Revenue:', JSON.stringify(newRev, null, 2));

    assert.strictEqual(newRev.totalRevenuePaise, legacyRev!.totalRevenuePaise, 'totalRevenuePaise match');
    assert.strictEqual(newRev.totalRevenueRupees, legacyRev!.totalRevenueRupees, 'totalRevenueRupees match');
    assert.strictEqual(newRev.netEarningsPaise, legacyRev!.netEarningsPaise, 'netEarningsPaise match');
    assert.strictEqual(newRev.netEarningsRupees, legacyRev!.netEarningsRupees, 'netEarningsRupees match');
    assert.strictEqual(newRev.todayRevenuePaise, legacyRev!.todayRevenuePaise, 'todayRevenuePaise match');
    assert.strictEqual(newRev.todayRevenueRupees, legacyRev!.todayRevenueRupees, 'todayRevenueRupees match');
    assert.strictEqual(newRev.weeklyRevenuePaise, legacyRev!.weeklyRevenuePaise, 'weeklyRevenuePaise match');
    assert.strictEqual(newRev.weeklyRevenueRupees, legacyRev!.weeklyRevenueRupees, 'weeklyRevenueRupees match');
    assert.strictEqual(newRev.monthlyRevenuePaise, legacyRev!.monthlyRevenuePaise, 'monthlyRevenuePaise match');
    assert.strictEqual(newRev.monthlyRevenueRupees, legacyRev!.monthlyRevenueRupees, 'monthlyRevenueRupees match');
    assert.strictEqual(newRev.completedPaymentsCount, legacyRev!.completedPaymentsCount, 'completedPaymentsCount match');
    assert.strictEqual(newRev.pendingPaymentsCount, legacyRev!.pendingPaymentsCount, 'pendingPaymentsCount match');
    console.log('✅ REVENUE ANALYTICS EQUALITY VERIFIED (100% Exact Match)\n');

    console.log('Comparing Settlements (Legacy vs Optimized)...');
    const legacySet = await legacyGetSettlements(testSellerId);
    const newSet = await SellerPaymentService.getSettlements(testSellerId);

    assert.strictEqual(newSet.availablePayoutAmountPaise, legacySet.availablePayoutAmountPaise, 'availablePayoutAmountPaise match');
    assert.strictEqual(newSet.pendingSettlementAmountPaise, legacySet.pendingSettlementAmountPaise, 'pendingSettlementAmountPaise match');
    assert.strictEqual(newSet.totalSettledAmountPaise, legacySet.totalSettledAmountPaise, 'totalSettledAmountPaise match');
    assert.strictEqual(newSet.settlements.length, legacySet.settlements.length, 'settlements count match');

    for (let i = 0; i < newSet.settlements.length; i++) {
      const sNew = newSet.settlements[i];
      const sOld = legacySet.settlements[i];
      assert.strictEqual(sNew.orderId, sOld.orderId, `settlement ${i} orderId match`);
      assert.strictEqual(sNew.grossAmountPaise, sOld.grossAmountPaise, `settlement ${i} gross match`);
      assert.strictEqual(sNew.platformFeePaise, sOld.platformFeePaise, `settlement ${i} fee match`);
      assert.strictEqual(sNew.netEarningsPaise, sOld.netEarningsPaise, `settlement ${i} net match`);
      assert.strictEqual(sNew.status, sOld.status, `settlement ${i} status match`);
    }
    console.log('✅ SETTLEMENTS EQUALITY VERIFIED (100% Exact Match)\n');

    console.log('Testing calculateSellerOrderEarnings pure calculations...');
    const calc = calculateSellerOrderEarnings(10000);
    assert.strictEqual(calc.grossPaise, 10000);
    assert.strictEqual(calc.commissionPaise, 500); // 5%
    assert.strictEqual(calc.gstPaise, 90); // 18% of 500
    assert.strictEqual(calc.netEarningsPaise, 9410); // 10000 - 500 - 90
    console.log('✅ COMMISSION & GST CALCULATIONS VERIFIED (5% platform fee, 18% GST)\n');

    console.log('================================================================');
    console.log('   ALL FINANCIAL CALCULATIONS & EQUIVALENCE TESTS PASSED       ');
    console.log('================================================================');

  } finally {
    if (createdLedgerIds.length) {
      await SellerLedger.deleteMany({ _id: { $in: createdLedgerIds } });
    }
    await disconnectDatabase();
  }
}

runFinancialTests().catch((err) => {
  console.error('Financial regression test failed:', err);
  process.exit(1);
});
