import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import CustomerOrder from '../models/CustomerOrder';
import SellerListing from '../models/SellerListing';
import SellerLedger from '../models/SellerLedger';
import SellerPayout from '../models/SellerPayout';
import SellerStoreSettings from '../models/SellerStoreSettings';
import MasterProduct from '../models/MasterProduct';
import Category from '../models/Category';
import { QcOrderService } from '../services/QcOrderService';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { SellerPaymentService } from '../services/SellerPaymentService';
import { getSellerMetrics } from '../services/SellerMetricsService';
import { SellerStoreSettingsService } from '../services/SellerStoreSettingsService';
import mongoose from 'mongoose';

async function runBenchmark() {
  console.log('=== STARTING SELLER BACKEND BENCHMARK & INVESTIGATION ===');
  await connectDatabase();

  // Inspect collections count
  const [
    sellerCount,
    orderCount,
    listingCount,
    ledgerCount,
    payoutCount,
    masterProductCount,
  ] = await Promise.all([
    Seller.countDocuments(),
    CustomerOrder.countDocuments(),
    SellerListing.countDocuments(),
    SellerLedger.countDocuments(),
    SellerPayout.countDocuments(),
    MasterProduct.countDocuments(),
  ]);

  console.log('\n--- COLLECTION DOCUMENT COUNTS ---');
  console.log(`Sellers: ${sellerCount}`);
  console.log(`CustomerOrders: ${orderCount}`);
  console.log(`SellerListings: ${listingCount}`);
  console.log(`SellerLedgers: ${ledgerCount}`);
  console.log(`SellerPayouts: ${payoutCount}`);
  console.log(`MasterProducts: ${masterProductCount}`);

  // List existing database indexes on key collections
  console.log('\n--- CURRENT MONGODB INDEXES ---');
  const collections = [
    { name: 'CustomerOrder', model: CustomerOrder },
    { name: 'SellerListing', model: SellerListing },
    { name: 'SellerLedger', model: SellerLedger },
    { name: 'SellerPayout', model: SellerPayout },
    { name: 'SellerStoreSettings', model: SellerStoreSettings },
    { name: 'Seller', model: Seller },
  ];

  for (const c of collections) {
    const indexes = await c.model.collection.indexes();
    console.log(`\nIndexes on ${c.name}:`);
    for (const idx of indexes) {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    }
  }

  // Find a test seller
  const seller = await Seller.findOne({ status: 'ACTIVE' }) || await Seller.findOne();
  const sellerId = seller ? seller._id.toString() : new mongoose.Types.ObjectId().toString();
  console.log(`\nTesting with Seller ID: ${sellerId} (${seller?.fullName || 'Mock'})`);

  // 1. Check Execution Plan for Orders Query
  console.log('\n--- QUERY EXPLAIN PLANS ---');
  try {
    const ordersExplain = await CustomerOrder.find({
      sellerId: new mongoose.Types.ObjectId(sellerId),
      paymentStatus: 'PAID',
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .explain('executionStats') as any;

    const ordersStats = ordersExplain.executionStats;
    const ordersPlan = ordersExplain.queryPlanner?.winningPlan;
    console.log('\n1. CustomerOrder.find({ sellerId, paymentStatus: "PAID" }).sort({ createdAt: -1 }):');
    console.log(`   Execution Time: ${ordersStats?.executionTimeMillis} ms`);
    console.log(`   Total Keys Examined: ${ordersStats?.totalKeysExamined}`);
    console.log(`   Total Docs Examined: ${ordersStats?.totalDocsExamined}`);
    console.log(`   Docs Returned: ${ordersStats?.nReturned}`);
    console.log(`   Stage: ${ordersPlan?.stage}`);
    console.log(`   Index Used: ${ordersPlan?.inputStage?.indexName || ordersPlan?.indexName || 'COLLSCAN / NONE'}`);
  } catch (err: any) {
    console.log('Orders explain error:', err.message);
  }

  // 2. Check Execution Plan for Seller Listings Query
  try {
    const listingsExplain = await SellerListing.find({ sellerId: new mongoose.Types.ObjectId(sellerId) })
      .sort({ updatedAt: -1 })
      .explain('executionStats') as any;

    const listingsStats = listingsExplain.executionStats;
    const listingsPlan = listingsExplain.queryPlanner?.winningPlan;
    console.log('\n2. SellerListing.find({ sellerId }).sort({ updatedAt: -1 }):');
    console.log(`   Execution Time: ${listingsStats?.executionTimeMillis} ms`);
    console.log(`   Total Keys Examined: ${listingsStats?.totalKeysExamined}`);
    console.log(`   Total Docs Examined: ${listingsStats?.totalDocsExamined}`);
    console.log(`   Docs Returned: ${listingsStats?.nReturned}`);
    console.log(`   Stage: ${listingsPlan?.stage}`);
    console.log(`   Index Used: ${listingsPlan?.inputStage?.indexName || listingsPlan?.indexName || 'COLLSCAN / NONE'}`);
  } catch (err: any) {
    console.log('Listings explain error:', err.message);
  }

  // 3. Check Execution Plan for SellerLedger Query
  try {
    const ledgerExplain = await SellerLedger.find({ sellerId: new mongoose.Types.ObjectId(sellerId) })
      .explain('executionStats') as any;
    const ledgerStats = ledgerExplain.executionStats;
    const ledgerPlan = ledgerExplain.queryPlanner?.winningPlan;
    console.log('\n3. SellerLedger.find({ sellerId }):');
    console.log(`   Execution Time: ${ledgerStats?.executionTimeMillis} ms`);
    console.log(`   Total Keys Examined: ${ledgerStats?.totalKeysExamined}`);
    console.log(`   Total Docs Examined: ${ledgerStats?.totalDocsExamined}`);
    console.log(`   Docs Returned: ${ledgerStats?.nReturned}`);
    console.log(`   Stage: ${ledgerPlan?.stage}`);
    console.log(`   Index Used: ${ledgerPlan?.inputStage?.indexName || ledgerPlan?.indexName || 'COLLSCAN / NONE'}`);
  } catch (err: any) {
    console.log('Ledger explain error:', err.message);
  }

  // 4. Check Execution Plan for SellerPayout Query
  try {
    const payoutExplain = await SellerPayout.find({ sellerId: new mongoose.Types.ObjectId(sellerId) })
      .sort({ requestedAt: -1 })
      .explain('executionStats') as any;
    const payoutStats = payoutExplain.executionStats;
    const payoutPlan = payoutExplain.queryPlanner?.winningPlan;
    console.log('\n4. SellerPayout.find({ sellerId }).sort({ requestedAt: -1 }):');
    console.log(`   Execution Time: ${payoutStats?.executionTimeMillis} ms`);
    console.log(`   Total Keys Examined: ${payoutStats?.totalKeysExamined}`);
    console.log(`   Total Docs Examined: ${payoutStats?.totalDocsExamined}`);
    console.log(`   Docs Returned: ${payoutStats?.nReturned}`);
    console.log(`   Stage: ${payoutPlan?.stage}`);
    console.log(`   Index Used: ${payoutPlan?.inputStage?.indexName || payoutPlan?.indexName || 'COLLSCAN / NONE'}`);
  } catch (err: any) {
    console.log('Payout explain error:', err.message);
  }

  // 5. Measure Actual End-to-End Service Method Timings
  console.log('\n--- MEASURING ACTUAL SERVICE METHOD TIMINGS ---');

  if (seller) {
    // Test listSellerOrders
    try {
      const t0 = Date.now();
      const ordersRes = await QcOrderService.listSellerOrders(sellerId);
      const dt = Date.now() - t0;
      console.log(`QcOrderService.listSellerOrders: ${dt} ms (Items: ${ordersRes.items.length})`);
    } catch (e: any) {
      console.log(`QcOrderService.listSellerOrders error: ${e.message}`);
    }

    // Test listMyListings
    try {
      const t0 = Date.now();
      const listingsRes = await SellerCatalogueService.listMyListings(sellerId, { limit: 200 });
      const dt = Date.now() - t0;
      console.log(`SellerCatalogueService.listMyListings(limit=200): ${dt} ms (Items: ${listingsRes.items.length})`);
    } catch (e: any) {
      console.log(`SellerCatalogueService.listMyListings error: ${e.message}`);
    }

    // Test getStoreSettings
    try {
      const t0 = Date.now();
      const settings = await SellerStoreSettingsService.getForSeller(sellerId);
      const dt = Date.now() - t0;
      console.log(`SellerStoreSettingsService.getForSeller: ${dt} ms (isOpen: ${settings.isOpen})`);
    } catch (e: any) {
      console.log(`SellerStoreSettingsService.getForSeller error: ${e.message}`);
    }

    // Test getEarningsSummary
    try {
      const t0 = Date.now();
      const summary = await SellerLedgerService.getEarningsSummary(sellerId);
      const dt = Date.now() - t0;
      console.log(`SellerLedgerService.getEarningsSummary: ${dt} ms (Today: ₹${summary.todayEarningsRupees})`);
    } catch (e: any) {
      console.log(`SellerLedgerService.getEarningsSummary error: ${e.message}`);
    }

    // Test getRevenueAnalytics
    try {
      const t0 = Date.now();
      const rev = await SellerPaymentService.getRevenueAnalytics(sellerId);
      const dt = Date.now() - t0;
      console.log(`SellerPaymentService.getRevenueAnalytics: ${dt} ms (Net: ₹${rev.netEarningsRupees})`);
    } catch (e: any) {
      console.log(`SellerPaymentService.getRevenueAnalytics error: ${e.message}`);
    }

    // Test getSettlements
    try {
      const t0 = Date.now();
      const stl = await SellerPaymentService.getSettlements(sellerId);
      const dt = Date.now() - t0;
      console.log(`SellerPaymentService.getSettlements: ${dt} ms (Settlements count: ${stl.settlements.length})`);
    } catch (e: any) {
      console.log(`SellerPaymentService.getSettlements error: ${e.message}`);
    }

    // Test getSellerMetrics
    try {
      const t0 = Date.now();
      const m = await getSellerMetrics(sellerId, '7d');
      const dt = Date.now() - t0;
      console.log(`getSellerMetrics(7d): ${dt} ms (Decided: ${m.decided})`);
    } catch (e: any) {
      console.log(`getSellerMetrics error: ${e.message}`);
    }
  }

  // Test listCategories
  try {
    const t0 = Date.now();
    const cats = await SellerCatalogueService.listCategories();
    const dt = Date.now() - t0;
    console.log(`SellerCatalogueService.listCategories: ${dt} ms (Count: ${cats.length})`);
  } catch (e: any) {
    console.log(`SellerCatalogueService.listCategories error: ${e.message}`);
  }

  console.log('\n=== BENCHMARK COMPLETED ===');
  await disconnectDatabase();
}

runBenchmark().catch((err) => {
  console.error('Benchmark script failed:', err);
  process.exit(1);
});
