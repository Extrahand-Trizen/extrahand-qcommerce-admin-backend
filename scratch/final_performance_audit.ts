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
import ProductTypeAttribute from '../src/models/ProductTypeAttribute';
import CustomerOrder from '../src/models/CustomerOrder';
import SellerDocument from '../src/models/SellerDocument';
import SellerOnboarding from '../src/models/SellerOnboarding';
import Seller from '../src/models/Seller';
import { SellerCatalogueService, invalidateTaxonomyCache } from '../src/services/SellerCatalogueService';

function nsToMs(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runFinalPerformanceAudit() {
  console.log('================================================================');
  console.log('       FINAL PERFORMANCE IMPROVEMENT AUDIT & STRESS TEST');
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

  // Warm-up database connection sockets
  await SellerListing.findOne({}).lean();

  // ==================================================================
  // PHASE 1 — CONCURRENCY INVESTIGATION (1, 5, 10, 20, 25, 50, 100)
  // ==================================================================
  console.log('=== PHASE 1: CONCURRENCY & CONNECTION POOL INVESTIGATION ===\n');

  const concurrencyLevels = [1, 5, 10, 20, 25, 50, 100];

  for (const c of concurrencyLevels) {
    const latencies: number[] = [];
    let errors = 0;
    const start = process.hrtime.bigint();

    await Promise.all(
      Array.from({ length: c }, async () => {
        const reqStart = process.hrtime.bigint();
        try {
          await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20 });
        } catch {
          errors++;
        }
        latencies.push(nsToMs(process.hrtime.bigint() - reqStart));
      }),
    );

    const totalMs = nsToMs(process.hrtime.bigint() - start);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const max = Math.max(...latencies);

    console.log(`Concurrency ${String(c).padStart(3, ' ')} Requests | Total Wall: ${totalMs.toFixed(2).padStart(8, ' ')} ms | Avg: ${avg.toFixed(2).padStart(7, ' ')} ms | P50: ${p50.toFixed(2).padStart(7, ' ')} ms | P95: ${p95.toFixed(2).padStart(8, ' ')} ms | P99: ${p99.toFixed(2).padStart(8, ' ')} ms | Max: ${max.toFixed(2).padStart(8, ' ')} ms | Error: ${((errors / c) * 100).toFixed(1)}%`);
  }

  // ==================================================================
  // PHASE 2 — PRODUCT SEARCH STRATEGIES COMPARISON
  // ==================================================================
  console.log('\n\n=== PHASE 2: PRODUCT SEARCH STRATEGY COMPARISON ===\n');

  const testTerms = ['mil', 'milk', 'rice', 'tea', 'a'];

  for (const term of testTerms) {
    console.log(`🔍 Search Term: "${term}"`);

    // 1. Current Substring Regex
    const t1 = process.hrtime.bigint();
    const res1 = await MasterProduct.find({
      status: 'ACTIVE',
      $or: [{ name: { $regex: term, $options: 'i' } }, { brand: { $regex: term, $options: 'i' } }],
    })
      .limit(20)
      .lean();
    const ms1 = nsToMs(process.hrtime.bigint() - t1);

    const exp1 = await MasterProduct.find({
      status: 'ACTIVE',
      $or: [{ name: { $regex: term, $options: 'i' } }, { brand: { $regex: term, $options: 'i' } }],
    })
      .limit(20)
      .explain('executionStats');
    const st1 = (exp1 as any).executionStats;

    console.log(`   Strategy 1 (Substring Regex):  ${ms1.toFixed(2)} ms | Matches: ${res1.length} | docsExamined: ${st1.totalDocsExamined} | keysExamined: ${st1.totalKeysExamined}`);
    console.log(`      Sample names: [${res1.slice(0, 2).map((d) => `"${d.name}"`).join(', ')}]`);

    // 2. Anchored Prefix Search (^term)
    const t2 = process.hrtime.bigint();
    const res2 = await MasterProduct.find({
      status: 'ACTIVE',
      $or: [{ name: { $regex: `^${term}`, $options: 'i' } }, { brand: { $regex: `^${term}`, $options: 'i' } }],
    })
      .limit(20)
      .lean();
    const ms2 = nsToMs(process.hrtime.bigint() - t2);

    const exp2 = await MasterProduct.find({
      status: 'ACTIVE',
      $or: [{ name: { $regex: `^${term}`, $options: 'i' } }, { brand: { $regex: `^${term}`, $options: 'i' } }],
    })
      .limit(20)
      .explain('executionStats');
    const st2 = (exp2 as any).executionStats;

    console.log(`   Strategy 2 (Anchored ^Regex):  ${ms2.toFixed(2)} ms | Matches: ${res2.length} | docsExamined: ${st2.totalDocsExamined} | keysExamined: ${st2.totalKeysExamined}`);
    console.log(`      Sample names: [${res2.slice(0, 2).map((d) => `"${d.name}"`).join(', ')}]\n`);
  }

  // ==================================================================
  // PHASE 3 — PAGINATION AUDIT
  // ==================================================================
  console.log('=== PHASE 3: PAGINATION OFFSET BENCHMARK ===\n');

  const pages = [1, 5, 10, 20, 50];
  for (const page of pages) {
    const skip = (page - 1) * 20;
    const tSkip = process.hrtime.bigint();
    await SellerListing.find({ sellerId: sellerObjId })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(20)
      .lean();
    const msSkip = nsToMs(process.hrtime.bigint() - tSkip);
    console.log(`  Page ${String(page).padStart(2, ' ')} (skip ${String(skip).padStart(4, ' ')}): ${msSkip.toFixed(2)} ms`);
  }

  // ==================================================================
  // PHASE 4 — FULL MODEL INDEX AUDIT
  // ==================================================================
  console.log('\n=== PHASE 4: FULL MODEL INDEX AUDIT & EXPLAIN STATS ===\n');

  const modelsToAudit = [
    { name: 'SellerListing', query: SellerListing.find({ sellerId: sellerObjId }).sort({ updatedAt: -1 }).limit(20) },
    { name: 'MasterProduct', query: MasterProduct.find({ status: 'ACTIVE' }).limit(20) },
    { name: 'ProductImage', query: ProductImage.find({ masterProductId: sellerObjId, isPrimary: true }) },
    { name: 'Promotion', query: Promotion.find({ sellerId: sellerObjId, state: 'ACTIVE' }) },
    { name: 'ProductSubmission', query: ProductSubmission.find({ sellerId: sellerId }) },
    { name: 'CustomerOrder', query: CustomerOrder.find({ sellerId: sellerObjId, paymentStatus: 'PAID' }).sort({ createdAt: -1 }).limit(20) },
    { name: 'SellerDocument', query: SellerDocument.find({ sellerId: sellerId }) },
    { name: 'SellerOnboarding', query: SellerOnboarding.find({ sellerId: sellerId }) },
    { name: 'Category', query: Category.find({ status: 'ACTIVE' }).select('name') },
    { name: 'Subcategory', query: Subcategory.find({ status: 'ACTIVE' }).select('name') },
    { name: 'ProductTypeAttribute', query: ProductTypeAttribute.find({ isVariantAttribute: true }).limit(20) },
  ];

  for (const m of modelsToAudit) {
    const explain = await m.query.explain('executionStats');
    const st = (explain as any).executionStats;
    const stage = st.executionStages?.stage || st.executionStages?.winningPlan?.stage || 'N/A';
    console.log(`Model: ${m.name.padEnd(20, ' ')} | time: ${st.executionTimeMillis} ms | keys: ${st.totalKeysExamined} | docs: ${st.totalDocsExamined} | returned: ${st.nReturned} | stage: ${stage}`);
  }

  await mongoose.disconnect();
  console.log('\n✓ Final performance audit run completed successfully.');
}

runFinalPerformanceAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
