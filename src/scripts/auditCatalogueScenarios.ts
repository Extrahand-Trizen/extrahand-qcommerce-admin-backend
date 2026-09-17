import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import mongoose, { Types } from 'mongoose';
import Seller from '../models/Seller';
import CustomerOrder from '../models/CustomerOrder';
import SellerListing from '../models/SellerListing';
import MasterProduct from '../models/MasterProduct';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import Attribute from '../models/Attribute';
import ProductType from '../models/ProductType';
import ProductTypeAttribute from '../models/ProductTypeAttribute';
import SellerLedger from '../models/SellerLedger';
import SellerPayout from '../models/SellerPayout';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { QcOrderService } from '../services/QcOrderService';
import { SellerPaymentService } from '../services/SellerPaymentService';
import { SellerService } from '../services/SellerService';
import { SellerStoreSettingsService } from '../services/SellerStoreSettingsService';

interface QueryLog {
  collection: string;
  method: string;
  query: any;
  durationMs?: number;
}

let queryLogs: QueryLog[] = [];
let queryTracingActive = false;

// Instrument mongoose debug to intercept all queries
mongoose.set('debug', (collectionName: string, methodName: string, ...methodArgs: any[]) => {
  if (!queryTracingActive) return;
  queryLogs.push({
    collection: collectionName,
    method: methodName,
    query: methodArgs[0],
  });
});

async function runDetailedAudit() {
  await connectDatabase();
  console.log('================================================================');
  console.log('       DETAILED CATALOGUE, PAGINATION & PAYLOAD AUDIT           ');
  console.log('================================================================');

  const activeSeller = await Seller.findOne({ status: 'ACTIVE' }) || await Seller.findOne();
  if (!activeSeller) throw new Error('No seller found');
  const activeSellerId = activeSeller._id.toString();

  // Pick or create test reference data
  let cat = await Category.findOne();
  if (!cat) cat = await Category.create({ name: 'Audit Category', code: 'AUDIT_CAT' });
  let sub = await Subcategory.findOne({ categoryId: cat._id });
  if (!sub) sub = await Subcategory.create({ categoryId: cat._id, name: 'Audit Subcat', slug: 'audit-subcat' });
  let pt = await ProductType.findOne({ subcategoryId: sub._id });
  if (!pt) pt = await ProductType.create({ subcategoryId: sub._id, name: 'Audit Type' });

  // ---------------------------------------------------------------------------
  // SECTION 2: CATALOGUE OPTIMIZATION TEST (0, 10, 100, Large catalogue)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. CATALOGUE AUDIT: 0, 10, 100, LARGE CATALOGUE ---');
  const tempSellerId = new Types.ObjectId().toString();
  const createdProductIds: Types.ObjectId[] = [];
  const createdListingIds: Types.ObjectId[] = [];

  try {
    // Generate 200 synthetic master products and listings for temp seller
    console.log('Setting up synthetic catalogue for isolation testing (up to 200 products)...');
    const BATCH_SIZE = 200;
    const mpDocs = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const pid = new Types.ObjectId();
      createdProductIds.push(pid);
      mpDocs.push({
        _id: pid,
        name: `Audit Item ${i + 1}`,
        brand: 'AuditBrand',
        sku: `AUDIT-SKU-${i + 1}-${Date.now()}`,
        slug: `audit-item-${i + 1}-${Date.now()}`,
        categoryId: cat._id,
        subcategoryId: sub._id,
        productTypeId: pt._id,
        status: 'ACTIVE',
        sellingPricePaise: 1000 + i * 50,
      });
    }
    await MasterProduct.insertMany(mpDocs);

    const listingDocs = mpDocs.map((mp, i) => {
      const lid = new Types.ObjectId();
      createdListingIds.push(lid);
      return {
        _id: lid,
        sellerId: new Types.ObjectId(tempSellerId),
        masterProductId: mp._id,
        sellingPricePaise: mp.sellingPricePaise,
        stock: 50,
        reserved: 5,
        status: 'ACTIVE',
        availability: 'AVAILABLE',
      };
    });

    // Helper to run catalogue measurement
    async function measureCatalogueScenario(label: string, sellerIdToTest: string, activeListingCount: number) {
      queryLogs = [];
      queryTracingActive = true;
      const t0 = performance.now();
      const res = await SellerCatalogueService.listMyListings(sellerIdToTest, { limit: 200 });
      const tTotal = performance.now() - t0;
      queryTracingActive = false;

      const collections = queryLogs.map((q) => q.collection);
      const categoryScans = collections.filter((c) => c === 'categories').length;
      const subcategoryScans = collections.filter((c) => c === 'subcategories').length;
      const attributeScans = collections.filter((c) => c === 'attributes').length;
      const payloadBytes = Buffer.byteLength(JSON.stringify(res));

      console.log(`\nScenario: ${label}`);
      console.log(`- Active Products Returned: ${res.items.length} (Total in Store: ${res.total})`);
      console.log(`- Total DB Queries Executed: ${queryLogs.length}`);
      console.log(`- Collections Queried: ${JSON.stringify(collections)}`);
      console.log(`- Category Scans: ${categoryScans}, Subcategory Scans: ${subcategoryScans}, Attribute Scans: ${attributeScans}`);
      console.log(`- Total API Execution Time: ${tTotal.toFixed(2)} ms`);
      console.log(`- Response Payload Size: ${(payloadBytes / 1024).toFixed(2)} KB (${payloadBytes} bytes)`);

      return {
        label,
        count: res.items.length,
        queries: queryLogs.length,
        tTotal: tTotal.toFixed(2),
        sizeKb: (payloadBytes / 1024).toFixed(2),
        scannedTaxonomy: categoryScans > 0 || subcategoryScans > 0 || attributeScans > 0,
      };
    }

    // Case 1: 0 products
    const c1 = await measureCatalogueScenario('Case 1: 0 Products', tempSellerId, 0);

    // Case 2: 10 products
    await SellerListing.insertMany(listingDocs.slice(0, 10));
    const c2 = await measureCatalogueScenario('Case 2: 10 Products', tempSellerId, 10);

    // Case 3: 100 products
    await SellerListing.insertMany(listingDocs.slice(10, 100));
    const c3 = await measureCatalogueScenario('Case 3: 100 Products', tempSellerId, 100);

    // Case 4: Large catalogue (200 products)
    await SellerListing.insertMany(listingDocs.slice(100, 200));
    const c4 = await measureCatalogueScenario('Case 4: Large Catalogue (200 Products)', tempSellerId, 200);

    console.log('\n--- CATALOGUE SUMMARY TABLE ---');
    console.table([c1, c2, c3, c4]);

  } finally {
    // Cleanup synthetic listings and products
    console.log('\nCleaning up synthetic audit data...');
    if (createdListingIds.length) {
      await SellerListing.deleteMany({ _id: { $in: createdListingIds } });
    }
    if (createdProductIds.length) {
      await MasterProduct.deleteMany({ _id: { $in: createdProductIds } });
    }
    console.log('Cleanup complete.');
  }

  // ---------------------------------------------------------------------------
  // SECTION 4: DUPLICATE QUERY AUDIT & BEFORE/AFTER QUERY COUNTS
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. DUPLICATE QUERY MEASUREMENTS ---');

  async function countQueriesFor(label: string, fn: () => Promise<any>) {
    queryLogs = [];
    queryTracingActive = true;
    const t0 = performance.now();
    await fn();
    const dt = performance.now() - t0;
    queryTracingActive = false;
    const colls = queryLogs.map((q) => `${q.collection}.${q.method}`);
    console.log(`\nEndpoint/Service: ${label}`);
    console.log(`- DB Queries Count: ${queryLogs.length}`);
    console.log(`- Query Breakdown: ${colls.join(', ')}`);
    console.log(`- Execution Time: ${dt.toFixed(2)} ms`);
    return { label, count: queryLogs.length, timeMs: dt.toFixed(2) };
  }

  const qRev = await countQueriesFor('Revenue Analytics (getRevenueAnalytics)', () => SellerPaymentService.getRevenueAnalytics(activeSellerId));
  const qSet = await countQueriesFor('Settlements (getSettlements)', () => SellerPaymentService.getSettlements(activeSellerId));
  const qMe = await countQueriesFor('Seller Onboarding / Me (getSeller)', () => SellerService.getSeller(activeSellerId));
  const qStore = await countQueriesFor('Store Settings (getForSeller)', () => SellerStoreSettingsService.getForSeller(activeSellerId));
  const qOrders = await countQueriesFor('Orders (listSellerOrders)', () => QcOrderService.listSellerOrders(activeSellerId));

  // ---------------------------------------------------------------------------
  // SECTION 8: PAGINATION SCALABILITY (page 1, 10, 50, 100, 500)
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. PAGINATION SCALABILITY (LARGE OFFSETS) ---');
  const testPages = [1, 10, 50, 100, 500];

  console.log('\nTesting CustomerOrder skip/limit vs offset:');
  for (const p of testPages) {
    const skip = (p - 1) * 20;
    const t0 = performance.now();
    const docs = await CustomerOrder.find({ sellerId: new Types.ObjectId(activeSellerId) })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(20)
      .lean();
    const dt = performance.now() - t0;
    console.log(`Page ${p} (skip: ${skip}, limit: 20): ${dt.toFixed(2)} ms (Returned: ${docs.length})`);
  }

  console.log('\nTesting SellerListing skip/limit vs offset:');
  for (const p of testPages) {
    const skip = (p - 1) * 20;
    const t0 = performance.now();
    const docs = await SellerListing.find({ sellerId: new Types.ObjectId(activeSellerId) })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(20)
      .lean();
    const dt = performance.now() - t0;
    console.log(`Page ${p} (skip: ${skip}, limit: 20): ${dt.toFixed(2)} ms (Returned: ${docs.length})`);
  }

  console.log('\nTesting SellerLedger skip/limit vs offset:');
  for (const p of testPages) {
    const skip = (p - 1) * 20;
    const t0 = performance.now();
    const docs = await SellerLedger.find({ sellerId: new Types.ObjectId(activeSellerId) })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(20)
      .lean();
    const dt = performance.now() - t0;
    console.log(`Page ${p} (skip: ${skip}, limit: 20): ${dt.toFixed(2)} ms (Returned: ${docs.length})`);
  }

  // ---------------------------------------------------------------------------
  // SECTION 10: PAYLOAD SIZE & TIMING BREAKDOWN
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. PAYLOAD & TIME BREAKDOWN AUDIT ---');

  async function profileBreakdown(name: string, fn: () => Promise<any>) {
    const t0 = performance.now();
    const data = await fn();
    const tData = performance.now();
    const jsonStr = JSON.stringify(data);
    const tJson = performance.now();
    const sizeBytes = Buffer.byteLength(jsonStr);

    const mongoAndAppTime = tData - t0;
    const serializeTime = tJson - tData;
    const totalTime = tJson - t0;

    console.log(`\nEndpoint: ${name}`);
    console.log(`- Total Time: ${totalTime.toFixed(2)} ms (DB + App Logic: ${mongoAndAppTime.toFixed(2)} ms, JSON Serialization: ${serializeTime.toFixed(2)} ms)`);
    console.log(`- Payload Size: ${(sizeBytes / 1024).toFixed(2)} KB (${sizeBytes} bytes)`);
  }

  await profileBreakdown('GET /seller/orders', () => QcOrderService.listSellerOrders(activeSellerId));
  await profileBreakdown('GET /seller/listings', () => SellerCatalogueService.listMyListings(activeSellerId, { limit: 200 }));
  await profileBreakdown('GET /seller/revenue', () => SellerPaymentService.getRevenueAnalytics(activeSellerId));
  await profileBreakdown('GET /seller/settlements', () => SellerPaymentService.getSettlements(activeSellerId));
  await profileBreakdown('GET /seller/store-settings', () => SellerStoreSettingsService.getForSeller(activeSellerId));
  await profileBreakdown('GET /seller/onboarding/me', () => SellerService.getSeller(activeSellerId));

  await disconnectDatabase();
}

runDetailedAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
