import mongoose from 'mongoose';
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

async function runAudit() {
  console.log('================================================================');
  console.log('   DEEP PERFORMANCE AUDIT - MONGODB & EXPLAIN PLANS (PHASE 1-31)');
  console.log('================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI || '', { dbName: process.env.MONGODB_DB || 'extrahand' });
  console.log('✓ Connected to MongoDB:', process.env.MONGODB_DB);

  // 1. Fetch a sample seller
  const sampleSeller = await Seller.findOne({}).lean();
  if (!sampleSeller) {
    console.log('❌ No sample seller found');
    process.exit(1);
  }
  const sellerId = sampleSeller._id;
  console.log(`✓ Sample Seller ID: ${sellerId} (${sampleSeller.fullName})`);

  // 2. Collection Counts
  console.log('\n--- COLLECTION DATA SIZES ---');
  const counts = {
    SellerListing: await SellerListing.countDocuments(),
    MasterProduct: await MasterProduct.countDocuments(),
    Category: await Category.countDocuments(),
    Subcategory: await Subcategory.countDocuments(),
    Attribute: await Attribute.countDocuments(),
    ProductImage: await ProductImage.countDocuments(),
    ProductSubmission: await ProductSubmission.countDocuments(),
    Promotion: await Promotion.countDocuments(),
    CustomerOrder: await CustomerOrder.countDocuments(),
    SellerLedger: await SellerLedger.countDocuments(),
    SellerPayout: await SellerPayout.countDocuments(),
    Seller: await Seller.countDocuments(),
  };
  console.table(counts);

  // 3. Index Inventory
  console.log('\n--- INDEX INVENTORY ---');
  const collections = [
    { name: 'SellerListing', model: SellerListing },
    { name: 'MasterProduct', model: MasterProduct },
    { name: 'CustomerOrder', model: CustomerOrder },
    { name: 'SellerLedger', model: SellerLedger },
    { name: 'SellerPayout', model: SellerPayout },
    { name: 'ProductImage', model: ProductImage },
    { name: 'Promotion', model: Promotion },
  ];

  for (const c of collections) {
    const indexes = await c.model.collection.indexes();
    console.log(`\nCollection: ${c.name} (${indexes.length} indexes)`);
    indexes.forEach((idx) => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });
  }

  // 4. EXPLAIN PLAN AUDIT: SellerListing fast path vs filter path
  console.log('\n--- EXPLAIN PLAN: SellerListing Fast Path ---');
  const fastPathFilter = { sellerId };
  const fastPathExplain = await SellerListing.find(fastPathFilter)
    .sort({ updatedAt: -1 })
    .skip(0)
    .limit(20)
    .explain('executionStats');

  const fpStats = (fastPathExplain as any).executionStats;
  console.log('Fast Path Execution Stats:');
  console.log(`  - executionTimeMillis: ${fpStats.executionTimeMillis} ms`);
  console.log(`  - totalKeysExamined: ${fpStats.totalKeysExamined}`);
  console.log(`  - totalDocsExamined: ${fpStats.totalDocsExamined}`);
  console.log(`  - nReturned: ${fpStats.nReturned}`);
  console.log(`  - winningPlan stage: ${fpStats.executionStages.stage}`);
  console.log(`  - indexName: ${fpStats.executionStages.inputStage?.indexName || 'N/A'}`);

  // Pagination skip scaling check
  console.log('\n--- PAGINATION DEGRADATION BENCHMARK (SellerListing) ---');
  const pages = [1, 2, 5, 10, 50, 100];
  for (const p of pages) {
    const skip = (p - 1) * 20;
    const start = Date.now();
    const explain = await SellerListing.find(fastPathFilter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(20)
      .explain('executionStats');
    const elapsed = Date.now() - start;
    const stats = (explain as any).executionStats;
    console.log(`Page ${p} (skip ${skip}): ${stats.executionTimeMillis} ms (wall ${elapsed} ms) | keys: ${stats.totalKeysExamined} | docs: ${stats.totalDocsExamined}`);
  }

  // 5. EXPLAIN PLAN: SellerListing Aggregation Pipeline (Search / Filter path)
  console.log('\n--- EXPLAIN PLAN: SellerListing Aggregation Filter Path ---');
  const pipeline: any[] = [
    { $match: { sellerId } },
    {
      $lookup: {
        from: 'masterproducts',
        localField: 'masterProductId',
        foreignField: '_id',
        as: 'product',
        pipeline: [
          { $match: { name: { $regex: 'tea', $options: 'i' } } },
          { $project: { _id: 1 } },
        ],
      },
    },
    { $match: { 'product.0': { $exists: true } } },
    { $sort: { updatedAt: -1 as const } },
    {
      $facet: {
        totalCount: [{ $count: 'total' }],
        items: [{ $skip: 0 }, { $limit: 20 }],
      },
    },
  ];

  const aggStart = Date.now();
  const [aggResult] = await SellerListing.aggregate(pipeline);
  const aggElapsed = Date.now() - aggStart;
  console.log(`Aggregation with Regex Search execution time: ${aggElapsed} ms`);
  console.log(`Result total: ${aggResult?.totalCount?.[0]?.total || 0}, items count: ${aggResult?.items?.length || 0}`);

  // 6. Benchmark countDocuments vs find
  console.log('\n--- COUNT vs FIND BENCHMARK ---');
  const t0 = Date.now();
  await SellerListing.countDocuments(fastPathFilter);
  const tCount = Date.now() - t0;

  const t1 = Date.now();
  await SellerListing.find(fastPathFilter).sort({ updatedAt: -1 }).skip(0).limit(20).lean();
  const tFind = Date.now() - t1;

  console.log(`countDocuments(sellerId): ${tCount} ms`);
  console.log(`find(sellerId).sort().limit(20): ${tFind} ms`);

  // 7. Orders Query Explain
  console.log('\n--- EXPLAIN PLAN: CustomerOrder Query ---');
  const orderExplain = await CustomerOrder.find({ sellerId, isPaid: true })
    .sort({ createdAt: -1 })
    .limit(20)
    .explain('executionStats');
  const orderStats = (orderExplain as any).executionStats;
  console.log('CustomerOrder Execution Stats:');
  console.log(`  - executionTimeMillis: ${orderStats.executionTimeMillis} ms`);
  console.log(`  - totalKeysExamined: ${orderStats.totalKeysExamined}`);
  console.log(`  - totalDocsExamined: ${orderStats.totalDocsExamined}`);
  console.log(`  - winningPlan stage: ${orderStats.executionStages.stage}`);

  // 8. SellerLedger Query Explain
  console.log('\n--- EXPLAIN PLAN: SellerLedger Query ---');
  const ledgerExplain = await SellerLedger.find({ sellerId })
    .sort({ createdAt: -1 })
    .limit(20)
    .explain('executionStats');
  const ledgerStats = (ledgerExplain as any).executionStats;
  console.log('SellerLedger Execution Stats:');
  console.log(`  - executionTimeMillis: ${ledgerStats.executionTimeMillis} ms`);
  console.log(`  - totalKeysExamined: ${ledgerStats.totalKeysExamined}`);
  console.log(`  - totalDocsExamined: ${ledgerStats.totalDocsExamined}`);
  console.log(`  - winningPlan stage: ${ledgerStats.executionStages.stage}`);

  await mongoose.disconnect();
  console.log('\n✓ Diagnostic complete.');
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
