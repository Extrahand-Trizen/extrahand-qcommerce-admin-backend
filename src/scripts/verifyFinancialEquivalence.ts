import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Types } from 'mongoose';
import Seller from '../models/Seller';
import SellerLedger from '../models/SellerLedger';
import CustomerOrder from '../models/CustomerOrder';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { SellerPaymentService } from '../services/SellerPaymentService';

async function runFinancialVerification() {
  await connectDatabase();
  console.log('--- Starting Financial Logic & Mathematical Verification ---');

  const sellers = await Seller.find({}).limit(5);
  console.log(`Found ${sellers.length} sellers to verify financial equations across.`);

  let allMatches = true;

  for (const seller of sellers) {
    const sid = seller._id;
    console.log(`\nVerifying Seller: ${sid} (${(seller as any).shopName || 'Store'})...`);

    // 1. Get raw ledger docs
    const ledgerDocs = await SellerLedger.find({ sellerId: sid }).lean();
    console.log(`  Ledger transactions count: ${ledgerDocs.length}`);

    // Compute expected financial metrics directly from math specifications
    let expectedTotalSettled = 0;
    let expectedPendingSettlement = 0;
    let expectedAvailablePayout = 0;
    let expectedTodayEarnings = 0;
    let expectedTotalCommission = 0;
    let expectedTotalGst = 0;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    for (const doc of ledgerDocs) {
      expectedTotalCommission += doc.commissionAmountPaise || 0;
      expectedTotalGst += doc.taxOnCommissionPaise || 0;

      if (doc.status === 'SETTLED') {
        expectedTotalSettled += doc.netAmountPaise || 0;
      } else if (doc.status === 'PENDING_SETTLEMENT') {
        expectedPendingSettlement += doc.netAmountPaise || 0;
      } else if (doc.status === 'AVAILABLE') {
        expectedAvailablePayout += doc.netAmountPaise || 0;
      }

      // Today earnings check (completedAt or createdAt >= startOfToday)
      const entryDate = doc.completedAt || doc.createdAt;
      if (entryDate && new Date(entryDate) >= startOfToday && (doc.status as string) !== 'PAYOUT_FAILED') {
        expectedTodayEarnings += doc.netAmountPaise || 0;
      }
    }

    console.log(`  Ledger transactions count: ${ledgerDocs.length}`);
    const summary = await SellerLedgerService.getEarningsSummary(sid);
    const today = await SellerLedgerService.getTodayEarnings(sid);
    const weekly = await SellerLedgerService.getWeeklyEarnings(sid, summary);
    const settlements = await SellerPaymentService.getSettlements(String(sid));
    const revenue = await SellerPaymentService.getRevenueAnalytics(String(sid));

    if (ledgerDocs.length > 0) {
      const matchSettled = summary.totalSettledPaise === expectedTotalSettled && settlements.totalSettledAmountPaise === expectedTotalSettled;
      const matchPending = summary.pendingSettlementPaise === expectedPendingSettlement && settlements.pendingSettlementAmountPaise === expectedPendingSettlement;
      const matchAvailable = summary.availablePayoutPaise === expectedAvailablePayout && settlements.availablePayoutAmountPaise === expectedAvailablePayout;
      const matchToday = today.todayEarningsPaise === expectedTodayEarnings;

      console.log(`  Settled Amount: summary=${summary.totalSettledPaise}, settlements=${settlements.totalSettledAmountPaise}, expected=${expectedTotalSettled} (match: ${matchSettled})`);
      console.log(`  Pending Settlement: summary=${summary.pendingSettlementPaise}, settlements=${settlements.pendingSettlementAmountPaise}, expected=${expectedPendingSettlement} (match: ${matchPending})`);
      console.log(`  Available Payout: summary=${summary.availablePayoutPaise}, settlements=${settlements.availablePayoutAmountPaise}, expected=${expectedAvailablePayout} (match: ${matchAvailable})`);
      console.log(`  Today's Earnings: ${today.todayEarningsPaise} vs expected ${expectedTodayEarnings} (match: ${matchToday})`);

      if (!matchSettled || !matchPending || !matchAvailable || !matchToday) allMatches = false;
    } else {
      console.log(`  (Legacy shop without ledger records - tested fallback path)`);
      console.log(`  Summary: settled=${summary.totalSettledPaise}, pending=${summary.pendingSettlementPaise}, available=${summary.availablePayoutPaise}`);
      console.log(`  Settlements API: settled=${settlements.totalSettledAmountPaise}, pending=${settlements.pendingSettlementAmountPaise}, available=${settlements.availablePayoutAmountPaise}`);
    }

    // Verify Commission and GST formula (commission = 5% of productTotal, GST = 18% of commission)
    for (const doc of ledgerDocs) {
      if (doc.grossAmountPaise > 0) {
        const expectedComm = Math.round(doc.grossAmountPaise * 0.05);
        const expectedTax = Math.round(expectedComm * 0.18);
        const expectedNet = doc.grossAmountPaise - expectedComm - expectedTax;

        if (doc.commissionAmountPaise !== expectedComm || doc.taxOnCommissionPaise !== expectedTax || doc.netAmountPaise !== expectedNet) {
          console.error(`  Mismatch in ledger doc ${doc._id}: gross=${doc.grossAmountPaise}, comm=${doc.commissionAmountPaise}(exp ${expectedComm}), tax=${doc.taxOnCommissionPaise}(exp ${expectedTax}), net=${doc.netAmountPaise}(exp ${expectedNet})`);
          allMatches = false;
        }
      }
    }
  }

  // Seed controlled seller with active ledger docs
  const testSellerId = new Types.ObjectId();
  const testOrderIds = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
  const testLedgerIds: Types.ObjectId[] = [];

  try {
    console.log(`\nVerifying Seeded Active Shop with Ledger Entries (Seller: ${testSellerId})...`);
    // Entry 1: SETTLED (gross 100000 -> net 94100)
    const l1 = await SellerLedger.create({
      sellerId: testSellerId,
      orderId: testOrderIds[0],
      orderNumber: 'FIN-TEST-ORD-1',
      transactionType: 'ORDER_EARNING',
      grossAmountPaise: 100000,
      commissionAmountPaise: 5000,
      taxOnCommissionPaise: 900,
      netAmountPaise: 94100,
      status: 'SETTLED',
      completedAt: new Date(),
    });
    testLedgerIds.push(l1._id);

    // Entry 2: PENDING_SETTLEMENT (gross 50000 -> net 47050)
    const l2 = await SellerLedger.create({
      sellerId: testSellerId,
      orderId: testOrderIds[1],
      orderNumber: 'FIN-TEST-ORD-2',
      transactionType: 'ORDER_EARNING',
      grossAmountPaise: 50000,
      commissionAmountPaise: 2500,
      taxOnCommissionPaise: 450,
      netAmountPaise: 47050,
      status: 'PENDING_SETTLEMENT',
      completedAt: new Date(),
      settlementEligibleAt: new Date(Date.now() + 48 * 3600000),
    });
    testLedgerIds.push(l2._id);

    // Entry 3: AVAILABLE (gross 200000 -> net 188200)
    const l3 = await SellerLedger.create({
      sellerId: testSellerId,
      orderId: testOrderIds[2],
      orderNumber: 'FIN-TEST-ORD-3',
      transactionType: 'ORDER_EARNING',
      grossAmountPaise: 200000,
      commissionAmountPaise: 10000,
      taxOnCommissionPaise: 1800,
      netAmountPaise: 188200,
      status: 'AVAILABLE',
      completedAt: new Date(),
    });
    testLedgerIds.push(l3._id);

    const summary = await SellerLedgerService.getEarningsSummary(testSellerId);
    const today = await SellerLedgerService.getTodayEarnings(testSellerId);
    const settlements = await SellerPaymentService.getSettlements(String(testSellerId));
    const revenue = await SellerPaymentService.getRevenueAnalytics(String(testSellerId));

    const matchSettled = summary.totalSettledPaise === 94100 && settlements.totalSettledAmountPaise === 94100;
    const matchPending = summary.pendingSettlementPaise === 47050 && settlements.pendingSettlementAmountPaise === 47050;
    const matchAvailable = summary.availablePayoutPaise === 188200 && settlements.availablePayoutAmountPaise === 188200;
    const expectedTodayNet = 94100 + 47050 + 188200; // all 3 completed today
    const matchToday = today.todayEarningsPaise === expectedTodayNet;

    console.log(`  Settled Amount: summary=${summary.totalSettledPaise}, settlements=${settlements.totalSettledAmountPaise} (Expected 94100, match: ${matchSettled})`);
    console.log(`  Pending Settlement: summary=${summary.pendingSettlementPaise}, settlements=${settlements.pendingSettlementAmountPaise} (Expected 47050, match: ${matchPending})`);
    console.log(`  Available Payout: summary=${summary.availablePayoutPaise}, settlements=${settlements.availablePayoutAmountPaise} (Expected 188200, match: ${matchAvailable})`);
    console.log(`  Today's Earnings: today=${today.todayEarningsPaise} (Expected ${expectedTodayNet}, match: ${matchToday})`);

    if (!matchSettled || !matchPending || !matchAvailable || !matchToday) {
      allMatches = false;
    }
  } finally {
    await SellerLedger.deleteMany({ _id: { $in: testLedgerIds } });
  }

  console.log(`\nFinancial Logic Verification: ${allMatches ? '100% VERIFIED AND MATCHED' : 'FAILED'}`);
  await disconnectDatabase();
}

runFinancialVerification().catch(console.error);
