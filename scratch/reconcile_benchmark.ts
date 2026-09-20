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

async function reconcileBenchmark() {
  console.log('================================================================');
  console.log('       BENCHMARK RECONCILIATION & TIMELINE AUDIT REPORT');
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
  // 1 & 2. PRECISE WALL-CLOCK TIMELINE & OVERLAP VERIFICATION
  // ==================================================================
  console.log('=== 1 & 2. PRECISE STAGE TIMELINE & OVERLAP AUDIT ===\n');

  invalidateTaxonomyCache();
  const globalStart = process.hrtime.bigint();

  const getOffset = (t: bigint) => nsToMs(t - globalStart).toFixed(2);

  // Stage 1: SellerListing
  const tAStart = process.hrtime.bigint();
  const listings = await SellerListing.find({ sellerId: sellerObjId })
    .sort({ updatedAt: -1 })
    .skip(0)
    .limit(20)
    .lean();
  const tAEnd = process.hrtime.bigint();
  const productIds = listings.map((l) => l.masterProductId);

  // Stage 2: Wave 1 (MasterProduct, Promotion, ProductSubmission)
  const tBStart = process.hrtime.bigint();

  const tMPStart = process.hrtime.bigint();
  const pMP = MasterProduct.find({ _id: { $in: productIds } })
    .select('name brand description categoryId subcategoryId productTypeId attributes sellingPricePaise lifespanValue lifespanUnit')
    .lean()
    .then((res) => ({ name: 'MasterProduct', start: tMPStart, end: process.hrtime.bigint(), res }));

  const now = new Date();
  const tPromoStart = process.hrtime.bigint();
  const pPromo = Promotion.find({
    sellerId,
    trigger: 'AUTOMATIC',
    state: 'ACTIVE',
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    productMasterIds: { $in: productIds },
  })
    .select('type value maxDiscountPaise endsAt productMasterIds')
    .lean()
    .then((res) => ({ name: 'Promotion', start: tPromoStart, end: process.hrtime.bigint(), res }));

  const tSubStart = process.hrtime.bigint();
  const pSub = ProductSubmission.find({
    sellerId,
    mappedMasterProductId: { $in: productIds },
  })
    .select('mappedMasterProductId status')
    .lean()
    .then((res) => ({ name: 'ProductSubmission', start: tSubStart, end: process.hrtime.bigint(), res }));

  const [mpRes, promoRes, subRes] = await Promise.all([pMP, pPromo, pSub]);
  const tBEnd = process.hrtime.bigint();
  const products = mpRes.res;

  // Stage 3: buildContext Wave
  const tCStart = process.hrtime.bigint();
  const typeIds = [...new Set(products.map((p) => String(p.productTypeId)))];

  const tCatStart = process.hrtime.bigint();
  const pCat = Category.find({}).select('name').lean().then((res) => ({ name: 'Category', start: tCatStart, end: process.hrtime.bigint(), res }));

  const tSubCatStart = process.hrtime.bigint();
  const pSubCat = Subcategory.find({}).select('name').lean().then((res) => ({ name: 'Subcategory', start: tSubCatStart, end: process.hrtime.bigint(), res }));

  const tAttrStart = process.hrtime.bigint();
  const pAttr = Attribute.find({}).select('key').lean().then((res) => ({ name: 'Attribute', start: tAttrStart, end: process.hrtime.bigint(), res }));

  const tPtAttrStart = process.hrtime.bigint();
  const pPtAttr = ProductTypeAttribute.find({ productTypeId: { $in: typeIds }, isVariantAttribute: true })
    .select('productTypeId attributeId variantOrder')
    .sort({ variantOrder: 1 })
    .lean()
    .then((res) => ({ name: 'ProductTypeAttribute', start: tPtAttrStart, end: process.hrtime.bigint(), res }));

  const tImgStart = process.hrtime.bigint();
  const pImg = ProductImage.find({ masterProductId: { $in: productIds }, isPrimary: true })
    .select('masterProductId imageUrl')
    .lean()
    .then((res) => ({ name: 'ProductImage', start: tImgStart, end: process.hrtime.bigint(), res }));

  const [catRes, subCatRes, attrRes, ptAttrRes, imgRes] = await Promise.all([pCat, pSubCat, pAttr, pPtAttr, pImg]);
  const tCEnd = process.hrtime.bigint();

  const totalEndpointMs = nsToMs(process.hrtime.bigint() - globalStart);

  console.log('Timeline Execution Offset Map (relative to request start = 0.00 ms):');
  console.log(`  [0.00 ms -> ${getOffset(tAEnd)} ms] SellerListing Query (Duration: ${nsToMs(tAEnd - tAStart).toFixed(2)} ms)`);
  console.log(`  [${getOffset(tBStart)} ms -> ${getOffset(tBEnd)} ms] Wave 1 Parallel Group (Duration: ${nsToMs(tBEnd - tBStart).toFixed(2)} ms)`);
  console.log(`     ├─ MasterProduct:       starts @ ${getOffset(mpRes.start)} ms, ends @ ${getOffset(mpRes.end)} ms (${nsToMs(mpRes.end - mpRes.start).toFixed(2)} ms)`);
  console.log(`     ├─ Promotion:           starts @ ${getOffset(promoRes.start)} ms, ends @ ${getOffset(promoRes.end)} ms (${nsToMs(promoRes.end - promoRes.start).toFixed(2)} ms)`);
  console.log(`     └─ ProductSubmission:   starts @ ${getOffset(subRes.start)} ms, ends @ ${getOffset(subRes.end)} ms (${nsToMs(subRes.end - subRes.start).toFixed(2)} ms)`);
  console.log(`  [${getOffset(tCStart)} ms -> ${getOffset(tCEnd)} ms] buildContext Wave (Duration: ${nsToMs(tCEnd - tCStart).toFixed(2)} ms)`);
  console.log(`     ├─ Category:            starts @ ${getOffset(catRes.start)} ms, ends @ ${getOffset(catRes.end)} ms (${nsToMs(catRes.end - catRes.start).toFixed(2)} ms)`);
  console.log(`     ├─ Subcategory:         starts @ ${getOffset(subCatRes.start)} ms, ends @ ${getOffset(subCatRes.end)} ms (${nsToMs(subCatRes.end - subCatRes.start).toFixed(2)} ms)`);
  console.log(`     ├─ Attribute:           starts @ ${getOffset(attrRes.start)} ms, ends @ ${getOffset(attrRes.end)} ms (${nsToMs(attrRes.end - attrRes.start).toFixed(2)} ms)`);
  console.log(`     ├─ ProductTypeAttribute:starts @ ${getOffset(ptAttrRes.start)} ms, ends @ ${getOffset(ptAttrRes.end)} ms (${nsToMs(ptAttrRes.end - ptAttrRes.start).toFixed(2)} ms)`);
  console.log(`     └─ ProductImage:        starts @ ${getOffset(imgRes.start)} ms, ends @ ${getOffset(imgRes.end)} ms (${nsToMs(imgRes.end - imgRes.start).toFixed(2)} ms)`);
  console.log(`  -------------------------------------------------------------`);
  console.log(`  Actual End-to-End Endpoint Wall-Clock Time: ${totalEndpointMs.toFixed(2)} ms\n`);

  // ==================================================================
  // 3. VERIFY ProductTypeAttribute EXPLAIN STATS
  // ==================================================================
  console.log('=== 3. ProductTypeAttribute DEEP QUERY ANALYSIS ===\n');

  const ptAttrExplain = await ProductTypeAttribute.find({
    productTypeId: { $in: typeIds },
    isVariantAttribute: true,
  })
    .sort({ variantOrder: 1 })
    .explain('executionStats');

  const ptStats = (ptAttrExplain as any).executionStats;
  console.log('ProductTypeAttribute Explain Stats:');
  console.log(`  - executionTimeMillis: ${ptStats.executionTimeMillis} ms`);
  console.log(`  - totalKeysExamined:   ${ptStats.totalKeysExamined}`);
  console.log(`  - totalDocsExamined:   ${ptStats.totalDocsExamined}`);
  console.log(`  - nReturned:          ${ptStats.nReturned}`);
  console.log(`  - winningPlan stage:  ${ptStats.executionStages?.stage || ptStats.executionStages?.winningPlan?.stage}`);

  // ==================================================================
  // 6. ISOLATED COLD vs WARM SINGLE REQUESTS
  // ==================================================================
  console.log('\n=== 6. ISOLATED COLD vs WARM ENDPOINT LATENCY ===\n');

  invalidateTaxonomyCache();
  const tCold = process.hrtime.bigint();
  await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20 });
  const coldMs = nsToMs(process.hrtime.bigint() - tCold);

  const tWarm = process.hrtime.bigint();
  await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20 });
  const warmMs = nsToMs(process.hrtime.bigint() - tWarm);

  console.log(`Cold-Cache Endpoint Latency: ${coldMs.toFixed(2)} ms`);
  console.log(`Warm-Cache Endpoint Latency: ${warmMs.toFixed(2)} ms\n`);

  // ==================================================================
  // 5. CONTROLLED BENCHMARK: 20 SEQUENTIAL WARM REQUESTS
  // ==================================================================
  console.log('=== 5. CONTROLLED BENCHMARK: 20 SEQUENTIAL WARM REQUESTS ===\n');

  const seqLatencies: number[] = [];
  for (let i = 0; i < 20; i++) {
    const tStart = process.hrtime.bigint();
    await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20 });
    seqLatencies.push(nsToMs(process.hrtime.bigint() - tStart));
  }

  const minL = Math.min(...seqLatencies);
  const maxL = Math.max(...seqLatencies);
  const avgL = seqLatencies.reduce((a, b) => a + b, 0) / seqLatencies.length;
  const p50L = percentile(seqLatencies, 50);
  const p95L = percentile(seqLatencies, 95);
  const p99L = percentile(seqLatencies, 99);

  console.log('20 Sequential Warm Requests Summary:');
  console.log(`  - Min:     ${minL.toFixed(2)} ms`);
  console.log(`  - Max:     ${maxL.toFixed(2)} ms`);
  console.log(`  - Avg:     ${avgL.toFixed(2)} ms`);
  console.log(`  - P50:     ${p50L.toFixed(2)} ms`);
  console.log(`  - P95:     ${p95L.toFixed(2)} ms`);
  console.log(`  - P99:     ${p99L.toFixed(2)} ms\n`);

  // ==================================================================
  // CONCURRENT BENCHMARKS (10, 25, 50 CONCURRENT)
  // ==================================================================
  console.log('=== CONCURRENT LOAD BENCHMARKS (10, 25, 50 CONCURRENT) ===\n');

  const concurrencyLevels = [10, 25, 50];
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
    console.log(`Concurrency Level ${c}:`);
    console.log(`  - Total Time: ${totalMs.toFixed(2)} ms`);
    console.log(`  - Avg:        ${(latencies.reduce((a, b) => a + b, 0) / c).toFixed(2)} ms`);
    console.log(`  - P50:        ${percentile(latencies, 50).toFixed(2)} ms`);
    console.log(`  - P95:        ${percentile(latencies, 95).toFixed(2)} ms`);
    console.log(`  - P99:        ${percentile(latencies, 99).toFixed(2)} ms`);
    console.log(`  - Error Rate: ${((errors / c) * 100).toFixed(1)}%\n`);
  }

  await mongoose.disconnect();
  console.log('✓ Reconciliation audit completed successfully.');
}

reconcileBenchmark().catch((err) => {
  console.error('Reconciliation error:', err);
  process.exit(1);
});
