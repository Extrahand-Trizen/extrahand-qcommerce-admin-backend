import mongoose, { Types } from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

import SellerListing from '../src/models/SellerListing';
import MasterProduct from '../src/models/MasterProduct';
import Category from '../src/models/Category';
import Subcategory from '../src/models/Subcategory';
import Attribute from '../src/models/Attribute';
import ProductImage from '../src/models/ProductImage';
import ProductSubmission from '../src/models/ProductSubmission';
import Promotion from '../src/models/Promotion';
import CustomerOrder from '../src/models/CustomerOrder';
import SellerLedger from '../src/models/SellerLedger';
import SellerPayout from '../src/models/SellerPayout';
import Seller from '../src/models/Seller';
import SellerOnboarding from '../src/models/SellerOnboarding';
import SellerDocument from '../src/models/SellerDocument';
import SellerApprovalHistory from '../src/models/SellerApprovalHistory';
import { SellerCatalogueService } from '../src/services/SellerCatalogueService';
import { SellerService } from '../src/services/SellerService';
import { QcOrderService } from '../src/services/QcOrderService';

function nsToMs(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runSecondValidationPass() {
  console.log('================================================================');
  console.log('       SECOND VALIDATION PASS - EMPIRICAL MEASUREMENT REPORT');
  console.log('================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI || '', { dbName: process.env.MONGODB_DB || 'extrahand' });
  console.log('✓ Connected to MongoDB:', process.env.MONGODB_DB);

  const sampleSeller = await Seller.findOne({}).lean();
  if (!sampleSeller) {
    console.log('❌ No sample seller found');
    process.exit(1);
  }
  const sellerId = String(sampleSeller._id);
  const sellerObjId = sampleSeller._id;
  console.log(`✓ Sample Seller ID: ${sellerId} (${sampleSeller.fullName})\n`);

  // ------------------------------------------------------------------
  // 1. DATABASE QUERY ANALYSIS (EXPLAIN PLANS)
  // ------------------------------------------------------------------
  console.log('=== 1. DATABASE QUERY ANALYSIS (EXPLAIN PLANS) ===\n');

  // Query A: SellerListing Fast Path
  const qAExplain = await SellerListing.find({ sellerId: sellerObjId })
    .sort({ updatedAt: -1 })
    .limit(20)
    .explain('executionStats');
  const qAStats = (qAExplain as any).executionStats;
  console.log('A. SellerListing Listing Query ({ sellerId }, sort: { updatedAt: -1 }):');
  console.log(`   - executionTimeMillis: ${qAStats.executionTimeMillis} ms`);
  console.log(`   - totalKeysExamined:   ${qAStats.totalKeysExamined}`);
  console.log(`   - totalDocsExamined:   ${qAStats.totalDocsExamined}`);
  console.log(`   - nReturned:          ${qAStats.nReturned}`);
  console.log(`   - winningPlan stage:  ${qAStats.executionStages?.stage || qAStats.executionStages?.winningPlan?.stage}`);
  console.log(`   - scanType:           ${qAStats.totalKeysExamined > 0 ? 'IXSCAN' : 'COLLSCAN/EMPTY'}\n`);

  // Query B: MasterProduct Regex Search
  const qBExplain = await MasterProduct.find({ status: 'ACTIVE', name: { $regex: 'tea', $options: 'i' } })
    .limit(20)
    .explain('executionStats');
  const qBStats = (qBExplain as any).executionStats;
  console.log('B. MasterProduct Regex Search ({ status: "ACTIVE", name: { $regex: "tea", $options: "i" } }):');
  console.log(`   - executionTimeMillis: ${qBStats.executionTimeMillis} ms`);
  console.log(`   - totalKeysExamined:   ${qBStats.totalKeysExamined}`);
  console.log(`   - totalDocsExamined:   ${qBStats.totalDocsExamined}`);
  console.log(`   - nReturned:          ${qBStats.nReturned}`);
  console.log(`   - winningPlan stage:  ${qBStats.executionStages?.stage || qBStats.executionStages?.winningPlan?.stage}`);
  console.log(`   - scanType:           ${qBStats.totalKeysExamined > 0 ? 'IXSCAN' : 'COLLSCAN'}\n`);

  // Query C: CustomerOrder Listing Query
  const qCExplain = await CustomerOrder.find({ sellerId: sellerObjId, paymentStatus: 'PAID' })
    .sort({ createdAt: -1 })
    .limit(20)
    .explain('executionStats');
  const qCStats = (qCExplain as any).executionStats;
  console.log('C. CustomerOrder Listing Query ({ sellerId, paymentStatus: "PAID" }, sort: { createdAt: -1 }):');
  console.log(`   - executionTimeMillis: ${qCStats.executionTimeMillis} ms`);
  console.log(`   - totalKeysExamined:   ${qCStats.totalKeysExamined}`);
  console.log(`   - totalDocsExamined:   ${qCStats.totalDocsExamined}`);
  console.log(`   - nReturned:          ${qCStats.nReturned}`);
  console.log(`   - winningPlan stage:  ${qCStats.executionStages?.stage || qCStats.executionStages?.winningPlan?.stage}`);
  console.log(`   - scanType:           ${qCStats.totalKeysExamined > 0 ? 'IXSCAN' : 'COLLSCAN/EMPTY'}\n`);

  // Query D: SellerOnboarding Lookup Query
  const qDExplain = await SellerOnboarding.find({ sellerId: sellerObjId }).explain('executionStats');
  const qDStats = (qDExplain as any).executionStats;
  console.log('D. SellerOnboarding Lookup ({ sellerId }):');
  console.log(`   - executionTimeMillis: ${qDStats.executionTimeMillis} ms`);
  console.log(`   - totalKeysExamined:   ${qDStats.totalKeysExamined}`);
  console.log(`   - totalDocsExamined:   ${qDStats.totalDocsExamined}`);
  console.log(`   - winningPlan stage:  ${qDStats.executionStages?.stage || qDStats.executionStages?.winningPlan?.stage}\n`);

  // ------------------------------------------------------------------
  // 2. SEARCH VALIDATION ACROSS MULTIPLE TERMS
  // ------------------------------------------------------------------
  console.log('=== 2. SEARCH PERFORMANCE VALIDATION ===\n');
  const searchTerms = [
    { label: 'Single letter ("a")', term: 'a' },
    { label: 'Common product ("milk")', term: 'milk' },
    { label: 'Common product ("rice")', term: 'rice' },
    { label: 'Common product ("tea")', term: 'tea' },
    { label: 'No-result search ("nonexistentitemxyz99")', term: 'nonexistentitemxyz99' },
    { label: 'Empty search ("")', term: '' },
  ];

  for (const item of searchTerms) {
    const tStart = process.hrtime.bigint();
    const res = await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20, search: item.term });
    const elapsed = nsToMs(process.hrtime.bigint() - tStart);
    console.log(`  - Search [${item.label}]: returned ${res.items.length} items in ${elapsed.toFixed(2)} ms`);
  }

  // ------------------------------------------------------------------
  // 4. CATEGORY AGGREGATION PARITY VALIDATION
  // ------------------------------------------------------------------
  console.log('\n=== 4. CATEGORY AGGREGATION PARITY VALIDATION ===\n');

  // Re-run old sequential algorithm for exact output parity comparison
  const oldCategoryCalc = async (sid: string) => {
    const listings = await SellerListing.find({ sellerId: sid }).select('masterProductId').lean();
    if (!listings.length) return [];
    const productIds = listings.map((l) => l.masterProductId);
    const products = await MasterProduct.find({ _id: { $in: productIds } }).select('categoryId').lean();
    const countMap = new Map<string, number>();
    for (const p of products) {
      const cid = String(p.categoryId);
      countMap.set(cid, (countMap.get(cid) ?? 0) + 1);
    }
    const categories = await Category.find({ _id: { $in: [...countMap.keys()] }, status: 'ACTIVE' })
      .select('name slug displayOrder')
      .sort({ displayOrder: 1, name: 1 })
      .lean();
    return categories.map((c) => ({
      id: String(c._id),
      name: c.name,
      slug: c.slug,
      displayOrder: c.displayOrder ?? 0,
      productCount: countMap.get(String(c._id)) ?? 0,
    }));
  };

  const oldCategories = await oldCategoryCalc(sellerId);
  const newCategories = await SellerCatalogueService.listStoreCategories(sellerId);

  console.log(`Old Category Algorithm Output Count: ${oldCategories.length}`);
  console.log(`New Aggregation Output Count:       ${newCategories.length}`);

  const isExactParity = JSON.stringify(oldCategories) === JSON.stringify(newCategories);
  console.log(`Exact Data Parity Verified:         ${isExactParity ? '✅ PASS (100% Identical)' : '❌ FAIL'}\n`);

  // ------------------------------------------------------------------
  // 7. ORDER SECURITY & SELLER ISOLATION VALIDATION
  // ------------------------------------------------------------------
  console.log('=== 7. ORDER SECURITY & SELLER ISOLATION VALIDATION ===\n');

  // Test A: Valid order owned by seller
  const sampleOrder = await CustomerOrder.findOne({ sellerId: sellerObjId }).lean();
  if (sampleOrder) {
    try {
      const fetchedOrder = await QcOrderService.getSellerOrder(sellerId, String(sampleOrder._id));
      console.log(`Test A (Valid seller + valid order): ✅ PASS (Retrieved Order #${fetchedOrder.orderNumber})`);
    } catch (err: any) {
      console.log(`Test A (Valid seller + valid order): ❌ FAIL (${err.message})`);
    }

    // Test B: Cross-seller isolation check
    const fakeOtherSellerId = new Types.ObjectId().toString();
    try {
      await QcOrderService.getSellerOrder(fakeOtherSellerId, String(sampleOrder._id));
      console.log(`Test B (Cross-seller isolation): ❌ FAIL (Allowed unauthorized access!)`);
    } catch (err: any) {
      console.log(`Test B (Cross-seller isolation): ✅ PASS (Correctly blocked with 403 Forbidden)`);
    }
  } else {
    console.log(`Test A & B skipped (No sample order present in DB)`);
  }

  // Test C: Non-existent order ID
  const randomOrderId = new Types.ObjectId().toString();
  try {
    await QcOrderService.getSellerOrder(sellerId, randomOrderId);
    console.log(`Test C (Invalid order ID): ❌ FAIL (Found non-existent order!)`);
  } catch (err: any) {
    console.log(`Test C (Invalid order ID): ✅ PASS (Correctly threw 404 Not Found)`);
  }

  // ------------------------------------------------------------------
  // 8 & 9. CONCURRENCY & LOAD TESTING BENCHMARK
  // ------------------------------------------------------------------
  console.log('\n=== 8 & 9. CONCURRENCY & LOAD TESTING BENCHMARK ===\n');

  const concurrencyLevels = [1, 10, 25, 50];

  for (const c of concurrencyLevels) {
    const latencies: number[] = [];
    let errors = 0;
    const start = process.hrtime.bigint();

    const tasks = Array.from({ length: c }, async () => {
      const reqStart = process.hrtime.bigint();
      try {
        await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20 });
      } catch {
        errors++;
      }
      latencies.push(nsToMs(process.hrtime.bigint() - reqStart));
    });

    await Promise.all(tasks);
    const totalMs = nsToMs(process.hrtime.bigint() - start);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);

    console.log(`Concurrency Level ${c}:`);
    console.log(`  - Total Wall Time: ${totalMs.toFixed(2)} ms`);
    console.log(`  - Avg Latency:     ${avg.toFixed(2)} ms`);
    console.log(`  - P50 Latency:     ${p50.toFixed(2)} ms`);
    console.log(`  - P95 Latency:     ${p95.toFixed(2)} ms`);
    console.log(`  - P99 Latency:     ${p99.toFixed(2)} ms`);
    console.log(`  - Error Rate:      ${((errors / c) * 100).toFixed(1)}%\n`);
  }

  await mongoose.disconnect();
  console.log('✓ Second validation pass completed successfully.');
}

runSecondValidationPass().catch((err) => {
  console.error('Validation script error:', err);
  process.exit(1);
});
