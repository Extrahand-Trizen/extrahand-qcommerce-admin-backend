import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import mongoose, { Types } from 'mongoose';
import Seller from '../models/Seller';
import CustomerOrder from '../models/CustomerOrder';
import SellerLedger from '../models/SellerLedger';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { SellerPaymentService } from '../services/SellerPaymentService';

async function run() {
  console.log('Connecting to database...');
  await connectDatabase();

  const totalSellers = await Seller.countDocuments();
  const totalOrders = await CustomerOrder.countDocuments();
  const totalLedgers = await SellerLedger.countDocuments();

  console.log(`\n=== DATABASE OVERVIEW ===`);
  console.log(`Total Sellers: ${totalSellers}`);
  console.log(`Total Orders: ${totalOrders}`);
  console.log(`Total Ledgers: ${totalLedgers}`);

  // Fetch all sellers
  const sellers: any[] = await Seller.find().lean();
  console.log('\n=== SELLERS ===');
  for (const s of sellers) {
    console.log(`ID: ${s._id} | Store: "${s.storeName || s.shopName || s.businessName || s.fullName}" | Phone: ${s.mobileNumber} | Status: ${s.status}`);
  }

  // Fetch recent 15 orders
  const orders: any[] = await CustomerOrder.find()
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  console.log('\n=== RECENT 15 CUSTOMER ORDERS ===');
  for (const o of orders) {
    console.log({
      id: String(o._id),
      orderNumber: o.orderNumber,
      sellerId: String(o.sellerId),
      amountPaise: o.amountPaise,
      itemTotalPaise: o.itemTotalPaise,
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      status: o.status,
      paidAt: o.paidAt,
      completedAt: o.completedAt,
      createdAt: o.createdAt,
    });
  }

  // Fetch recent 15 ledgers
  const ledgers = await SellerLedger.find()
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  console.log('\n=== RECENT 15 SELLER LEDGERS ===');
  for (const l of ledgers) {
    console.log({
      id: String(l._id),
      sellerId: String(l.sellerId),
      orderId: String(l.orderId),
      orderNumber: l.orderNumber,
      transactionType: l.transactionType,
      gross: l.grossAmountPaise,
      net: l.netAmountPaise,
      status: l.status,
      completedAt: l.completedAt,
      settlementEligibleAt: l.settlementEligibleAt,
      createdAt: l.createdAt,
    });
  }

  // Test earnings for each seller
  for (const s of sellers) {
    const sid = String(s._id);
    const storeTitle = s.storeName || s.shopName || s.businessName || s.fullName;
    const sOrderCount = await CustomerOrder.countDocuments({ sellerId: s._id });
    const sPaidOrderCount = await CustomerOrder.countDocuments({ sellerId: s._id, paymentStatus: 'PAID' });
    const sLedgerCount = await SellerLedger.countDocuments({ sellerId: s._id });

    console.log(`\n================ SELLER ${sid} ("${storeTitle}") ================`);
    console.log(`Orders total: ${sOrderCount} | Paid: ${sPaidOrderCount} | Ledgers: ${sLedgerCount}`);

    const summary = await SellerLedgerService.getEarningsSummary(sid);
    console.log('getEarningsSummary:', summary);

    const today = await SellerLedgerService.getTodayEarnings(sid);
    console.log('getTodayEarnings:', today);

    const weekly = await SellerLedgerService.getWeeklyEarnings(sid);
    console.log('getWeeklyEarnings:', {
      grossSalesPaise: weekly.grossSalesPaise,
      netEarningsPaise: weekly.netEarningsPaise,
      dailyBreakdown: weekly.dailyBreakdown.map((d) => ({ day: d.dayName, date: d.date, net: d.netEarningsPaise, orders: d.ordersCount })),
    });

    const rev = await SellerPaymentService.getRevenueAnalytics(sid);
    console.log('getRevenueAnalytics:', rev);

    const setts = await SellerPaymentService.getSettlements(sid);
    console.log('getSettlements:', {
      availablePayoutAmountPaise: setts.availablePayoutAmountPaise,
      pendingSettlementAmountPaise: setts.pendingSettlementAmountPaise,
      totalSettledAmountPaise: setts.totalSettledAmountPaise,
      settlementsCount: setts.settlements.length,
      sampleSettlement: setts.settlements[0] || null,
    });
  }

  await disconnectDatabase();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
