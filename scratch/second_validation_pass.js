const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const SellerListing = require('../dist/models/SellerListing').default;
const MasterProduct = require('../dist/models/MasterProduct').default;
const Category = require('../dist/models/Category').default;
const Subcategory = require('../dist/models/Subcategory').default;
const Attribute = require('../dist/models/Attribute').default;
const ProductImage = require('../dist/models/ProductImage').default;
const ProductSubmission = require('../dist/models/ProductSubmission').default;
const Promotion = require('../dist/models/Promotion').default;
const CustomerOrder = require('../dist/models/CustomerOrder').default;
const SellerLedger = require('../dist/models/SellerLedger').default;
const SellerPayout = require('../dist/models/SellerPayout').default;
const Seller = require('../dist/models/Seller').default;
const SellerOnboarding = require('../dist/models/SellerOnboarding').default;
const SellerDocument = require('../dist/models/SellerDocument').default;

function nsToMs(ns) {
  return Number(ns) / 1000000;
}

async function validateAll() {
  console.log('================================================================');
  console.log('       SECOND VALIDATION PASS - EMPIRICAL AUDIT REPORT');
  console.log('================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI || '', { dbName: process.env.MONGODB_DB || 'extrahand' });
  console.log('✓ Connected to MongoDB:', process.env.MONGODB_DB);

  const sampleSeller = await Seller.findOne({}).lean();
  if (!sampleSeller) {
    console.log('❌ No sample seller found');
    process.exit(1);
  }
  const sellerId = String(sampleSeller._id);
  console.log(`✓ Sample Seller ID: ${sellerId} (${sampleSeller.fullName})`);

  // 1. CATALOGUE STAGE-BY-STAGE TIMING BREAKDOWN
  console.log('\n--- 1. CATALOGUE STAGE-BY-STAGE TIMING BREAKDOWN ---');
  
  const tTaxonomyStart = process.hrtime.bigint();
  await Category.find({ status: 'ACTIVE' }).select('name slug displayOrder').lean();
  await Subcategory.find({}).select('name').lean();
  await Attribute.find({}).select('key').lean();
  const taxonomyTime = nsToMs(process.hrtime.bigint() - tTaxonomyStart);

  const tListingStart = process.hrtime.bigint();
  const listings = await SellerListing.find({ sellerId: new mongoose.Types.ObjectId(sellerId) })
    .sort({ updatedAt: -1 })
    .skip(0)
    .limit(20)
    .lean();
  const listingQueryTime = nsToMs(process.hrtime.bigint() - tListingStart);

  const tCountStart = process.hrtime.bigint();
  const totalListingsCount = await SellerListing.countDocuments({ sellerId: new mongoose.Types.ObjectId(sellerId) });
  const countTime = nsToMs(process.hrtime.bigint() - tCountStart);

  const productIds = listings.map(l => l.masterProductId);
  const tMasterStart = process.hrtime.bigint();
  const masterProducts = await MasterProduct.find({ _id: { $in: productIds } })
    .select('name brand description categoryId subcategoryId productTypeId attributes sellingPricePaise lifespanValue lifespanUnit')
    .lean();
  const masterProductTime = nsToMs(process.hrtime.bigint() - tMasterStart);

  const tImageStart = process.hrtime.bigint();
  await ProductImage.find({ masterProductId: { $in: productIds }, isPrimary: true })
    .select('masterProductId imageUrl')
    .lean();
  const imageTime = nsToMs(process.hrtime.bigint() - tImageStart);

  const tSubmissionStart = process.hrtime.bigint();
  await ProductSubmission.find({ sellerId, mappedMasterProductId: { $in: productIds } })
    .select('mappedMasterProductId status')
    .lean();
  const submissionTime = nsToMs(process.hrtime.bigint() - tSubmissionStart);

  const tPromoStart = process.hrtime.bigint();
  await Promotion.find({
    sellerId: new mongoose.Types.ObjectId(sellerId),
    state: 'ACTIVE',
    productMasterIds: { $in: productIds },
  }).lean();
  const promoTime = nsToMs(process.hrtime.bigint() - tPromoStart);

  const tTransformStart = process.hrtime.bigint();
  const items = listings.map(l => ({
    id: String(l._id),
    masterProductId: String(l.masterProductId),
    sellingPricePaise: l.sellingPricePaise,
    stock: l.stock,
    reserved: l.reserved,
    available: Math.max(0, (l.stock || 0) - (l.reserved || 0)),
  }));
  const transformTime = nsToMs(process.hrtime.bigint() - tTransformStart);

  const tSerStart = process.hrtime.bigint();
  const jsonString = JSON.stringify({ items, total: totalListingsCount });
  const serTime = nsToMs(process.hrtime.bigint() - tSerStart);
  const payloadSizeBytes = Buffer.byteLength(jsonString, 'utf8');

  console.log(`Taxonomy Query/Cache:        ${taxonomyTime.toFixed(3)} ms`);
  console.log(`SellerListing Query (top 20):${listingQueryTime.toFixed(3)} ms`);
  console.log(`countDocuments Query:        ${countTime.toFixed(3)} ms`);
  console.log(`MasterProduct Batch Query:   ${masterProductTime.toFixed(3)} ms`);
  console.log(`ProductImage Primary Query:  ${imageTime.toFixed(3)} ms`);
  console.log(`ProductSubmission Query:     ${submissionTime.toFixed(3)} ms`);
  console.log(`Promotion/Offer Query:       ${promoTime.toFixed(3)} ms`);
  console.log(`Stock Math & Transformation: ${transformTime.toFixed(3)} ms`);
  console.log(`JSON Serialization:          ${serTime.toFixed(3)} ms`);
  console.log(`-----------------------------------------------`);
  console.log(`Response Payload Size:       ${(payloadSizeBytes / 1024).toFixed(2)} KB`);

  // 2. VERIFY SellerListing PROJECTION
  console.log('\n--- 2. SellerListing PROJECTION VALIDATION ---');
  const fullDocs = await SellerListing.find({ sellerId: new mongoose.Types.ObjectId(sellerId) }).limit(20).lean();
  const projDocs = await SellerListing.find({ sellerId: new mongoose.Types.ObjectId(sellerId) })
    .select('masterProductId sellingPricePaise compareAtPricePaise availability stock reserved status reviewStatus updatedAt sellerId')
    .limit(20)
    .lean();

  const fullKeys = fullDocs.length ? Object.keys(fullDocs[0]) : [];
  const projKeys = projDocs.length ? Object.keys(projDocs[0]) : [];

  console.log('Unprojected Fields:', fullKeys.join(', '));
  console.log('Projected Fields:  ', projKeys.join(', '));

  const fullSize = Buffer.byteLength(JSON.stringify(fullDocs));
  const projSize = Buffer.byteLength(JSON.stringify(projDocs));
  console.log(`Unprojected 20 Docs Size: ${fullSize} bytes`);
  console.log(`Projected 20 Docs Size:   ${projSize} bytes (${(((fullSize - projSize) / fullSize) * 100).toFixed(1)}% reduction)`);

  // 3. PROMOTION QUERY AUDIT
  console.log('\n--- 3. PROMOTION QUERY EXPLAIN PLAN ---');
  const promoExplain = await Promotion.find({
    sellerId: new mongoose.Types.ObjectId(sellerId),
    state: 'ACTIVE',
  }).explain('executionStats');

  const pStats = promoExplain.executionStats;
  console.log('Promotion Query Stats:');
  console.log(`  - executionTimeMillis: ${pStats.executionTimeMillis} ms`);
  console.log(`  - totalKeysExamined:   ${pStats.totalKeysExamined}`);
  console.log(`  - totalDocsExamined:   ${pStats.totalDocsExamined}`);
  console.log(`  - winningPlan stage:   ${pStats.executionStages.stage}`);

  // 4. REGEX SEARCH AUDIT
  console.log('\n--- 4. REGEX SEARCH PERFORMANCE ---');
  const searchQueries = ['', 'tea', 'rareitemxyz', '000000', 'a', 'organic tea leaves'];
  for (const q of searchQueries) {
    const start = process.hrtime.bigint();
    const res = await MasterProduct.find(q ? { name: { $regex: q, $options: 'i' } } : {}).limit(20).lean();
    const elapsed = nsToMs(process.hrtime.bigint() - start);
    console.log("Search '" + (q || '<NONE>') + "': " + res.length + " matches | time: " + elapsed.toFixed(2) + " ms");
  }

  // 5. listStoreCategories BENCHMARK
  console.log('\n--- 5. listStoreCategories CURRENT vs AGGREGATION BENCHMARK ---');
  const tCurrStart = process.hrtime.bigint();
  const listingsStore = await SellerListing.find({ sellerId: new mongoose.Types.ObjectId(sellerId) }).select('masterProductId').lean();
  const pIds = listingsStore.map(l => l.masterProductId);
  const productsStore = await MasterProduct.find({ _id: { $in: pIds } }).select('categoryId').lean();
  const countByCat = new Map();
  for (const p of productsStore) {
    const cId = String(p.categoryId);
    countByCat.set(cId, (countByCat.get(cId) || 0) + 1);
  }
  const currentMs = nsToMs(process.hrtime.bigint() - tCurrStart);

  const tAggStart = process.hrtime.bigint();
  const aggResult = await SellerListing.aggregate([
    { $match: { sellerId: new mongoose.Types.ObjectId(sellerId) } },
    {
      $lookup: {
        from: 'masterproducts',
        localField: 'masterProductId',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
    { $group: { _id: '$product.categoryId', productCount: { $sum: 1 } } },
    {
      $lookup: {
        from: 'categories',
        localField: '_id',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: '$category' },
    { $match: { 'category.status': 'ACTIVE' } },
    {
      $project: {
        id: { $toString: '$_id' },
        name: '$category.name',
        slug: '$category.slug',
        displayOrder: '$category.displayOrder',
        productCount: 1,
      },
    },
    { $sort: { displayOrder: 1, name: 1 } },
  ]);
  const aggMs = nsToMs(process.hrtime.bigint() - tAggStart);

  console.log(`Current listStoreCategories: ${currentMs.toFixed(2)} ms (${countByCat.size} categories)`);
  console.log(`Aggregation $group prototype: ${aggMs.toFixed(2)} ms (${aggResult.length} categories)`);

  // 6. ORDERS INDEX & PROJECTION VALIDATION
  console.log('\n--- 6. CustomerOrder INDEX & PROJECTION AUDIT ---');
  const orderExplain = await CustomerOrder.find({ sellerId: new mongoose.Types.ObjectId(sellerId), isPaid: true })
    .sort({ createdAt: -1 })
    .explain('executionStats');
  
  const oStats = orderExplain.executionStats;
  console.log('CustomerOrder Execution Stats:');
  console.log(`  - executionTimeMillis: ${oStats.executionTimeMillis} ms`);
  console.log(`  - totalKeysExamined:   ${oStats.totalKeysExamined}`);
  console.log(`  - totalDocsExamined:   ${oStats.totalDocsExamined}`);
  console.log(`  - winningPlan stage:   ${oStats.executionStages.stage}`);

  const unprojOrders = await CustomerOrder.find({ sellerId: new mongoose.Types.ObjectId(sellerId) }).limit(10).lean();
  const projOrders = await CustomerOrder.find({ sellerId: new mongoose.Types.ObjectId(sellerId) })
    .select('orderNumber status fulfillmentStatus totalAmountPaise items.name items.quantity items.pricePaise createdAt')
    .limit(10)
    .lean();

  const unprojSize = Buffer.byteLength(JSON.stringify(unprojOrders));
  const projOrderSize = Buffer.byteLength(JSON.stringify(projOrders));
  console.log(`Unprojected 10 Orders Size: ${unprojSize} bytes`);
  console.log(`Projected 10 Orders Size:   ${projOrderSize} bytes (${(((unprojSize - projOrderSize) / unprojSize) * 100).toFixed(1)}% reduction)`);

  // 8. ONBOARDING BENCHMARK
  console.log('\n--- 8. ONBOARDING SEQUENTIAL vs PROMISE.ALL BENCHMARK ---');
  const tSeqStart = process.hrtime.bigint();
  await Seller.findById(sellerId).lean();
  await SellerOnboarding.findOne({ sellerId }).lean();
  await SellerDocument.find({ sellerId }).lean();
  const seqMs = nsToMs(process.hrtime.bigint() - tSeqStart);

  const tParStart = process.hrtime.bigint();
  await Promise.all([
    Seller.findById(sellerId).lean(),
    SellerOnboarding.findOne({ sellerId }).lean(),
    SellerDocument.find({ sellerId }).lean(),
  ]);
  const parMs = nsToMs(process.hrtime.bigint() - tParStart);

  console.log(`Sequential Onboarding Fetch: ${seqMs.toFixed(2)} ms`);
  console.log(`Promise.all Onboarding Fetch: ${parMs.toFixed(2)} ms (${(((seqMs - parMs) / seqMs) * 100).toFixed(1)}% speedup)`);

  await mongoose.disconnect();
  console.log('\n✓ Second validation pass complete.');
}

validateAll().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
