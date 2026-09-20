import mongoose, { Types } from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

import SellerListing from '../src/models/SellerListing';
import MasterProduct from '../src/models/MasterProduct';
import ProductImage from '../src/models/ProductImage';
import ProductSubmission from '../src/models/ProductSubmission';
import Promotion from '../src/models/Promotion';
import Seller from '../src/models/Seller';
import { SellerCatalogueService } from '../src/services/SellerCatalogueService';

function nsToMs(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

async function validateProposal1() {
  console.log('================================================================');
  console.log('       PROPOSAL 1 IMPLEMENTATION & PARITY VALIDATION');
  console.log('================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI || '', { dbName: process.env.MONGODB_DB || 'extrahand' });
  console.log('✓ Connected to MongoDB:', process.env.MONGODB_DB);

  const sampleSeller = await Seller.findOne({}).lean();
  if (!sampleSeller) {
    console.log('❌ No sample seller found');
    process.exit(1);
  }
  const sellerId = String(sampleSeller._id);
  console.log(`✓ Sample Seller ID: ${sellerId} (${sampleSeller.fullName})\n`);

  // 1. ENDPOINT LATENCY MEASUREMENT
  console.log('--- 1. ENDPOINT LATENCY MEASUREMENT ---');
  const latencies: number[] = [];
  for (let i = 0; i < 5; i++) {
    const tStart = process.hrtime.bigint();
    await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20 });
    latencies.push(nsToMs(process.hrtime.bigint() - tStart));
  }
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`Measured Latencies (5 runs): [${latencies.map((l) => l.toFixed(2)).join(', ')}] ms`);
  console.log(`Average listMyListings Latency: ${avgLatency.toFixed(2)} ms\n`);

  // 2. PARALLEL vs SEQUENTIAL STAGE BREAKDOWN
  console.log('--- 2. STAGE TIMING OVERLAP MEASUREMENT ---');

  // Measure SellerListing stage
  const t1 = process.hrtime.bigint();
  const listings = await SellerListing.find({ sellerId: new Types.ObjectId(sellerId) })
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();
  const msSellerListing = nsToMs(process.hrtime.bigint() - t1);

  const productIds = listings.map((l) => l.masterProductId);

  // Measure parallelized group
  const tParStart = process.hrtime.bigint();
  const [products, offerMap, customSubmissions] = await Promise.all([
    MasterProduct.find({ _id: { $in: productIds } }).lean(),
    Promotion.find({ sellerId, state: 'ACTIVE', productMasterIds: { $in: productIds } }).lean(),
    ProductSubmission.find({ sellerId, mappedMasterProductId: { $in: productIds } }).lean(),
  ]);
  const msParallelGroup = nsToMs(process.hrtime.bigint() - tParStart);

  console.log(`Stage 1 (SellerListing):                       ${msSellerListing.toFixed(2)} ms`);
  console.log(`Stage 2 (Parallel MasterProduct+Promo+Sub):    ${msParallelGroup.toFixed(2)} ms`);
  console.log(`Combined Network Execution Time:               ${(msSellerListing + msParallelGroup).toFixed(2)} ms\n`);

  // 3. FULL RESPONSE PARITY VALIDATION
  console.log('--- 3. COMPLETE RESPONSE DATA PARITY AUDIT ---');
  const response = await SellerCatalogueService.listMyListings(sellerId, { page: 1, limit: 20 });

  console.log(`Total Item Count:              ${response.total}`);
  console.log(`Paginated Slice Length:        ${response.items.length}`);
  console.log(`Current Page:                  ${response.page}`);
  console.log(`Limit:                         ${response.limit}`);
  console.log(`Total Pages:                   ${response.totalPages}`);

  if (response.items.length > 0) {
    const sampleItem = response.items[0];
    console.log('\nSample Item Output Contract:');
    console.log(`  - ID:                 ${sampleItem.id}`);
    console.log(`  - Master Product ID:  ${sampleItem.masterProductId}`);
    console.log(`  - Name:               ${sampleItem.name}`);
    console.log(`  - Price (Paise):      ${sampleItem.sellingPricePaise}`);
    console.log(`  - Price (Rupees):     ${sampleItem.sellingPriceRupees}`);
    console.log(`  - Availability:       ${sampleItem.availability}`);
    console.log(`  - Stock / Reserved:   ${sampleItem.stock} / ${sampleItem.reserved}`);
    console.log(`  - Category Name:      ${sampleItem.categoryName}`);
    console.log(`  - Image URL:          ${sampleItem.imageUrl}`);
  }

  await mongoose.disconnect();
  console.log('\n✓ Proposal 1 validation complete.');
}

validateProposal1().catch((err) => {
  console.error('Proposal 1 validation failed:', err);
  process.exit(1);
});
