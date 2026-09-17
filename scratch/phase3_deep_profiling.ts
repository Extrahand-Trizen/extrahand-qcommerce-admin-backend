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
import Seller from '../src/models/Seller';

function nsToMs(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

async function profilePhase3() {
  console.log('================================================================');
  console.log('       PHASE 3: DEEP STAGE-BY-STAGE PROFILING & SEARCH BENCHMARK');
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

  // ==================================================================
  // PHASE 3A — MASTER PRODUCT SEARCH COMPARISON
  // ==================================================================
  console.log('--- PHASE 3A: SEARCH APPROACHES COMPARISON ---\n');

  const terms = ['a', 'milk', 'mil', 'milky', 'rice', 'tea', 'organic', 'nonexistentitemxyz99', ''];

  for (const term of terms) {
    console.log(`\n🔍 --- Term: "${term}" ---`);

    // Approach A: Substring Regex
    const filterA: any = { status: 'ACTIVE' };
    if (term.trim()) {
      filterA.$or = [
        { name: { $regex: term.trim(), $options: 'i' } },
        { brand: { $regex: term.trim(), $options: 'i' } },
      ];
    }
    const tAStart = process.hrtime.bigint();
    const docsA = await MasterProduct.find(filterA).limit(20).lean();
    const msA = nsToMs(process.hrtime.bigint() - tAStart);

    const expA = await MasterProduct.find(filterA).limit(20).explain('executionStats');
    const stA = (expA as any).executionStats;

    console.log(`Approach A (Substring Regex): ${msA.toFixed(2)} ms | Returned: ${docsA.length} | docsExamined: ${stA.totalDocsExamined} | keysExamined: ${stA.totalKeysExamined} | stage: ${stA.executionStages?.stage}`);
    console.log(`   Sample names A: [${docsA.slice(0, 3).map((d) => `"${d.name}"`).join(', ')}]`);

    // Approach B: MongoDB Text Index ($text)
    let msB = 0;
    let docsB: any[] = [];
    let stB: any = { totalDocsExamined: 0, totalKeysExamined: 0, executionStages: { stage: 'N/A' } };

    if (term.trim()) {
      const filterB: any = { status: 'ACTIVE', $text: { $search: term.trim() } };
      const tBStart = process.hrtime.bigint();
      try {
        docsB = await MasterProduct.find(filterB).limit(20).lean();
        msB = nsToMs(process.hrtime.bigint() - tBStart);
        const expB = await MasterProduct.find(filterB).limit(20).explain('executionStats');
        stB = (expB as any).executionStats;
        console.log(`Approach B ($text Search):     ${msB.toFixed(2)} ms | Returned: ${docsB.length} | docsExamined: ${stB.totalDocsExamined} | keysExamined: ${stB.totalKeysExamined} | stage: ${stB.executionStages?.stage}`);
        console.log(`   Sample names B: [${docsB.slice(0, 3).map((d) => `"${d.name}"`).join(', ')}]`);
      } catch (err: any) {
        console.log(`Approach B ($text Search):     Failed (${err.message})`);
      }
    } else {
      console.log(`Approach B ($text Search):     Skipped for empty term`);
    }

    // Approach C: Anchored Prefix Regex (^term)
    if (term.trim()) {
      const filterC: any = { status: 'ACTIVE' };
      const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filterC.$or = [
        { name: { $regex: `^${escaped}`, $options: 'i' } },
        { brand: { $regex: `^${escaped}`, $options: 'i' } },
      ];
      const tCStart = process.hrtime.bigint();
      const docsC = await MasterProduct.find(filterC).limit(20).lean();
      const msC = nsToMs(process.hrtime.bigint() - tCStart);
      const expC = await MasterProduct.find(filterC).limit(20).explain('executionStats');
      const stC = (expC as any).executionStats;
      console.log(`Approach C (Anchored ^Regex):  ${msC.toFixed(2)} ms | Returned: ${docsC.length} | docsExamined: ${stC.totalDocsExamined} | keysExamined: ${stC.totalKeysExamined} | stage: ${stC.executionStages?.stage}`);
      console.log(`   Sample names C: [${docsC.slice(0, 3).map((d) => `"${d.name}"`).join(', ')}]`);
    }
  }

  // ==================================================================
  // PHASE 3B — SELLER CATALOGUE LISTING STAGE-BY-STAGE PROFILING
  // ==================================================================
  console.log('\n\n--- PHASE 3B: STAGE-BY-STAGE PROFILING (listMyListings) ---\n');

  // Stage 1: SellerListing query
  const t1 = process.hrtime.bigint();
  const listings = await SellerListing.find({ sellerId: sellerObjId })
    .sort({ updatedAt: -1 })
    .skip(0)
    .limit(20)
    .lean();
  const ms1 = nsToMs(process.hrtime.bigint() - t1);

  const productIds = listings.map((l) => l.masterProductId);

  // Stage 2: MasterProduct lookup
  const t2 = process.hrtime.bigint();
  const products = await MasterProduct.find({ _id: { $in: productIds } })
    .select('name brand description categoryId subcategoryId productTypeId attributes sellingPricePaise lifespanValue lifespanUnit')
    .lean();
  const ms2 = nsToMs(process.hrtime.bigint() - t2);

  // Stage 3: ProductImage lookup
  const t3 = process.hrtime.bigint();
  const images = await ProductImage.find({ masterProductId: { $in: productIds }, isPrimary: true })
    .select('masterProductId imageUrl')
    .lean();
  const ms3 = nsToMs(process.hrtime.bigint() - t3);

  // Stage 4: ProductSubmission lookup
  const t4 = process.hrtime.bigint();
  const customSubmissions = await ProductSubmission.find({
    sellerId,
    mappedMasterProductId: { $in: productIds },
  })
    .select('mappedMasterProductId status')
    .lean();
  const ms4 = nsToMs(process.hrtime.bigint() - t4);

  // Stage 5: Promotion/offer lookup
  const t5 = process.hrtime.bigint();
  const now = new Date();
  const promos = await Promotion.find({
    sellerId,
    trigger: 'AUTOMATIC',
    state: 'ACTIVE',
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    productMasterIds: { $in: productIds },
  })
    .select('type value maxDiscountPaise endsAt productMasterIds')
    .lean();
  const ms5 = nsToMs(process.hrtime.bigint() - t5);

  // Stage 6: Category & Subcategory Taxonomy Context
  const t6 = process.hrtime.bigint();
  const categoryIds = [...new Set(products.map((p) => String(p.categoryId)))];
  const subcategoryIds = [...new Set(products.map((p) => String(p.subcategoryId)))];
  await Promise.all([
    Category.find({ _id: { $in: categoryIds } }).select('name').lean(),
    Subcategory.find({ _id: { $in: subcategoryIds } }).select('name').lean(),
  ]);
  const ms6 = nsToMs(process.hrtime.bigint() - t6);

  // Stage 7: DTO Transformation
  const t7 = process.hrtime.bigint();
  const items = listings.map((l) => ({
    id: String(l._id),
    masterProductId: String(l.masterProductId),
    sellingPricePaise: l.sellingPricePaise,
    stock: l.stock,
    reserved: l.reserved,
    available: Math.max(0, (l.stock || 0) - (l.reserved || 0)),
  }));
  const ms7 = nsToMs(process.hrtime.bigint() - t7);

  // Stage 8: JSON Serialization
  const t8 = process.hrtime.bigint();
  const jsonStr = JSON.stringify({ items, total: listings.length });
  const ms8 = nsToMs(process.hrtime.bigint() - t8);

  const totalMeasuredMs = ms1 + ms2 + ms3 + ms4 + ms5 + ms6 + ms7 + ms8;

  console.log('Stage-by-Stage Timing Breakdown:');
  console.log(`  1. SellerListing Query:     ${ms1.toFixed(3)} ms (${((ms1 / totalMeasuredMs) * 100).toFixed(1)}%)`);
  console.log(`  2. MasterProduct Batch:     ${ms2.toFixed(3)} ms (${((ms2 / totalMeasuredMs) * 100).toFixed(1)}%)`);
  console.log(`  3. ProductImage Primary:    ${ms3.toFixed(3)} ms (${((ms3 / totalMeasuredMs) * 100).toFixed(1)}%)`);
  console.log(`  4. ProductSubmission Query: ${ms4.toFixed(3)} ms (${((ms4 / totalMeasuredMs) * 100).toFixed(1)}%)`);
  console.log(`  5. Promotion/Offer Query:   ${ms5.toFixed(3)} ms (${((ms5 / totalMeasuredMs) * 100).toFixed(1)}%)`);
  console.log(`  6. Taxonomy Context Query:  ${ms6.toFixed(3)} ms (${((ms6 / totalMeasuredMs) * 100).toFixed(1)}%)`);
  console.log(`  7. DTO Transformation:     ${ms7.toFixed(3)} ms (${((ms7 / totalMeasuredMs) * 100).toFixed(1)}%)`);
  console.log(`  8. JSON Serialization:      ${ms8.toFixed(3)} ms (${((ms8 / totalMeasuredMs) * 100).toFixed(1)}%)`);
  console.log(`  -------------------------------------------------------------`);
  console.log(`  Total Measured Execution:   ${totalMeasuredMs.toFixed(3)} ms\n`);

  await mongoose.disconnect();
  console.log('✓ Phase 3 deep profiling completed successfully.');
}

profilePhase3().catch((err) => {
  console.error('Phase 3 profiling error:', err);
  process.exit(1);
});
