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
import SellerOnboarding from '../src/models/SellerOnboarding';
import SellerDocument from '../src/models/SellerDocument';
import { SellerCatalogueService } from '../src/services/SellerCatalogueService';

function nsToMs(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

async function validateAll() {
  console.log('================================================================');
  console.log('       BASELINE PERFORMANCE AUDIT & BENCHMARK REPORT');
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

  // 1. CATALOGUE SERVICE BENCHMARK
  console.log('--- 1. CATALOGUE SERVICE BENCHMARK ---');
  
  const tCatServiceStart = process.hrtime.bigint();
  const sellerListingsRes = await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20 });
  const catServiceMs = nsToMs(process.hrtime.bigint() - tCatServiceStart);

  const catPayloadBytes = Buffer.byteLength(JSON.stringify(sellerListingsRes), 'utf8');

  console.log(`SellerCatalogueService.listMyListings (top 20): ${catServiceMs.toFixed(2)} ms`);
  console.log(`Catalogue Response Item Count:                 ${sellerListingsRes.items.length}`);
  console.log(`Catalogue Response Payload Size:              ${(catPayloadBytes / 1024).toFixed(2)} KB`);

  // 2. EXPLAIN PLAN FOR LISTINGS
  console.log('\n--- 2. SELLER LISTINGS EXPLAIN PLAN ---');
  const listingExplain = await SellerListing.find({ sellerId: sellerObjId })
    .sort({ updatedAt: -1 })
    .skip(0)
    .limit(20)
    .explain('executionStats');

  const lStats = (listingExplain as any).executionStats;
  console.log(`SellerListing Query Execution Time: ${lStats.executionTimeMillis} ms`);
  console.log(`  - totalKeysExamined: ${lStats.totalKeysExamined}`);
  console.log(`  - totalDocsExamined: ${lStats.totalDocsExamined}`);
  console.log(`  - nReturned:          ${lStats.nReturned}`);

  // 3. STORE CATEGORIES BENCHMARK
  console.log('\n--- 3. STORE CATEGORIES BENCHMARK ---');
  const tCatStart = process.hrtime.bigint();
  const storeCategories = await SellerCatalogueService.listStoreCategories(sellerId);
  const storeCatMs = nsToMs(process.hrtime.bigint() - tCatStart);
  console.log(`SellerCatalogueService.listStoreCategories: ${storeCatMs.toFixed(2)} ms (${storeCategories.length} categories)`);

  // 4. SEARCH PERFORMANCE BENCHMARK
  console.log('\n--- 4. SEARCH PERFORMANCE BENCHMARK ---');
  const searchQueries = ['tea', 'rareitemxyz', 'a'];
  for (const q of searchQueries) {
    const start = process.hrtime.bigint();
    const searchRes = await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20, search: q });
    const elapsed = nsToMs(process.hrtime.bigint() - start);
    console.log(`Search '${q}': ${searchRes.items.length} matches | Service Latency: ${elapsed.toFixed(2)} ms`);
  }

  // 5. CUSTOMER ORDERS EXPLAIN & LATENCY
  console.log('\n--- 5. CUSTOMER ORDERS QUERY EXPLAIN & BENCHMARK ---');
  const tOrderStart = process.hrtime.bigint();
  const orders = await CustomerOrder.find({ sellerId: sellerObjId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  const orderMs = nsToMs(process.hrtime.bigint() - tOrderStart);
  const orderPayloadBytes = Buffer.byteLength(JSON.stringify(orders), 'utf8');

  const orderExplain = await CustomerOrder.find({ sellerId: sellerObjId })
    .sort({ createdAt: -1 })
    .limit(20)
    .explain('executionStats');
  const oStats = (orderExplain as any).executionStats;

  console.log(`CustomerOrder Query Latency:        ${orderMs.toFixed(2)} ms`);
  console.log(`CustomerOrder 20 Docs Payload Size: ${(orderPayloadBytes / 1024).toFixed(2)} KB`);
  console.log(`  - executionTimeMillis: ${oStats.executionTimeMillis} ms`);
  console.log(`  - totalKeysExamined:   ${oStats.totalKeysExamined}`);
  console.log(`  - totalDocsExamined:   ${oStats.totalDocsExamined}`);
  console.log(`  - nReturned:          ${oStats.nReturned}`);

  // 6. SELLER ONBOARDING / PROFILE FETCH BENCHMARK
  console.log('\n--- 6. SELLER ONBOARDING & PROFILE BENCHMARK ---');
  const tSeqStart = process.hrtime.bigint();
  await Seller.findById(sellerId);
  await SellerOnboarding.findOne({ sellerId });
  await SellerDocument.find({ sellerId });
  const seqMs = nsToMs(process.hrtime.bigint() - tSeqStart);

  const tParStart = process.hrtime.bigint();
  await Promise.all([
    Seller.findById(sellerId).lean(),
    SellerOnboarding.findOne({ sellerId }).lean(),
    SellerDocument.find({ sellerId }).lean(),
  ]);
  const parMs = nsToMs(process.hrtime.bigint() - tParStart);

  console.log(`Sequential Onboarding Fetch:   ${seqMs.toFixed(2)} ms`);
  console.log(`Parallel Lean Onboarding Fetch: ${parMs.toFixed(2)} ms`);

  await mongoose.disconnect();
  console.log('\n✓ Baseline performance run complete.');
}

validateAll().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
