import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import mongoose, { FilterQuery, Types } from 'mongoose';
import Seller from '../models/Seller';
import SellerListing from '../models/SellerListing';
import MasterProduct from '../models/MasterProduct';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import assert from 'node:assert';

// The legacy implementation before MongoDB-native pagination:
async function legacyListMyListings(
  sellerId: string,
  query: any,
) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const listingFilter: FilterQuery<typeof SellerListing> = { sellerId };
  if (query.availability) {
    const up = query.availability.toUpperCase();
    if (['AVAILABLE', 'LIMITED', 'OUT_OF_STOCK'].includes(up)) listingFilter.availability = up;
  }

  const listings = await SellerListing.find(listingFilter).sort({ updatedAt: -1 }).lean();

  let products = await MasterProduct.find({ _id: { $in: listings.map((l) => l.masterProductId) } })
    .select('name brand description categoryId subcategoryId productTypeId attributes sellingPricePaise lifespanValue lifespanUnit')
    .lean();

  if (query.categoryId) {
    products = products.filter((p) => String(p.categoryId) === String(query.categoryId));
  }
  if (query.subcategoryId) {
    products = products.filter((p) => String(p.subcategoryId) === String(query.subcategoryId));
  }
  if (query.search?.trim()) {
    const q = query.search.trim().toLowerCase();
    products = products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q),
    );
  }
  const productById = new Map(products.map((p) => [String(p._id), p]));

  const allItems = listings
    .filter((l) => productById.has(String(l.masterProductId)))
    .map((l) => {
      const p = productById.get(String(l.masterProductId))!;
      const stock = Math.max(0, l.stock ?? 0);
      const reserved = Math.max(0, l.reserved ?? 0);
      const available = Math.max(0, stock - reserved);
      return {
        id: String(l._id),
        masterProductId: String(p._id),
        name: p.name,
        sellingPricePaise: l.sellingPricePaise,
        availability: (l.availability || 'AVAILABLE').toLowerCase(),
        stock,
        reserved,
        available,
      };
    })
    .filter((item) => {
      if (!query.stockStatus || query.stockStatus === 'all') return true;
      if (query.stockStatus === 'in_stock') return item.available > 0;
      if (query.stockStatus === 'out_of_stock') return item.available <= 0;
      return true;
    });

  const total = allItems.length;
  const items = allItems.slice(skip, skip + limit);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
}

async function runEquivalenceTests() {
  await connectDatabase();
  console.log('================================================================');
  console.log('       SELLER LISTING FUNCTIONAL EQUIVALENCE TEST SUITE         ');
  console.log('================================================================');

  // Set up an ephemeral test seller with known dataset
  const sellerId = new Types.ObjectId().toString();
  const existingCats = await Category.find().limit(2);
  const catA = existingCats[0] || await Category.create({ name: 'Equiv Cat A', code: 'EQA01', slug: 'equiv-cat-a' });
  const catB = existingCats[1] || await Category.create({ name: 'Equiv Cat B', code: 'EQB02', slug: 'equiv-cat-b' });
  const subA = await Subcategory.findOne({ categoryId: catA._id }) || await Subcategory.create({ categoryId: catA._id, name: 'Equiv Sub A', slug: 'eq-sub-a' });
  const subB = await Subcategory.findOne({ categoryId: catB._id }) || await Subcategory.create({ categoryId: catB._id, name: 'Equiv Sub B', slug: 'eq-sub-b' });
  const pt = await ProductType.findOne() || await ProductType.create({ subcategoryId: subA._id, name: 'Equiv PT' });

  const testProductIds: Types.ObjectId[] = [];
  const testListingIds: Types.ObjectId[] = [];

  try {
    console.log('Creating 30 test products and listings across two categories and stock levels...');
    const mpDocs = [];
    for (let i = 0; i < 30; i++) {
      const pid = new Types.ObjectId();
      testProductIds.push(pid);
      const isCatB = i % 3 === 0;
      mpDocs.push({
        _id: pid,
        name: `Product ${i < 10 ? 'Apple' : i < 20 ? 'Banana' : 'Cherry'} #${i + 1}`,
        brand: i % 2 === 0 ? 'BrandAlpha' : 'BrandBeta',
        sku: `EQUIV-SKU-${i + 1}-${Date.now()}`,
        slug: `equiv-item-${i + 1}-${Date.now()}`,
        categoryId: isCatB ? catB._id : catA._id,
        subcategoryId: isCatB ? subB._id : subA._id,
        productTypeId: pt._id,
        status: 'ACTIVE',
        sellingPricePaise: 1000 + i * 100,
      });
    }
    await MasterProduct.insertMany(mpDocs);

    const listingDocs = mpDocs.map((mp, i) => {
      const lid = new Types.ObjectId();
      testListingIds.push(lid);
      const isOos = i % 4 === 0;
      return {
        _id: lid,
        sellerId: new Types.ObjectId(sellerId),
        masterProductId: mp._id,
        sellingPricePaise: mp.sellingPricePaise,
        stock: isOos ? 0 : 25 + i,
        reserved: isOos ? 0 : 2,
        status: 'ACTIVE',
        availability: isOos ? 'OUT_OF_STOCK' : 'AVAILABLE',
        updatedAt: new Date(Date.now() - i * 1000), // strictly descending timestamps
      };
    });
    await SellerListing.insertMany(listingDocs);

    console.log('Dataset populated. Running 9 equivalence test cases...\n');

    async function assertEquivalence(caseName: string, query: any) {
      const legacyRes = await legacyListMyListings(sellerId, query);
      const newRes = await SellerCatalogueService.listMyListings(sellerId, query);

      console.log(`Testing Case: ${caseName}`);
      console.log(`  Query: ${JSON.stringify(query)}`);
      console.log(`  Legacy Total: ${legacyRes.total}, New Total: ${newRes.total}`);
      console.log(`  Legacy Returned: ${legacyRes.items.length}, New Returned: ${newRes.items.length}`);

      assert.strictEqual(newRes.total, legacyRes.total, `${caseName}: total mismatch`);
      assert.strictEqual(newRes.page, legacyRes.page, `${caseName}: page mismatch`);
      assert.strictEqual(newRes.limit, legacyRes.limit, `${caseName}: limit mismatch`);
      assert.strictEqual(newRes.totalPages, legacyRes.totalPages, `${caseName}: totalPages mismatch`);
      assert.strictEqual(newRes.items.length, legacyRes.items.length, `${caseName}: items length mismatch`);

      for (let i = 0; i < newRes.items.length; i++) {
        const itemNew = newRes.items[i];
        const itemOld = legacyRes.items[i];
        assert.strictEqual(itemNew.id, itemOld.id, `${caseName} item ${i}: id mismatch`);
        assert.strictEqual(itemNew.masterProductId, itemOld.masterProductId, `${caseName} item ${i}: masterProductId mismatch`);
        assert.strictEqual(itemNew.name, itemOld.name, `${caseName} item ${i}: name mismatch`);
        assert.strictEqual(itemNew.sellingPricePaise, itemOld.sellingPricePaise, `${caseName} item ${i}: sellingPricePaise mismatch`);
        assert.strictEqual(itemNew.stock, itemOld.stock, `${caseName} item ${i}: stock mismatch`);
        assert.strictEqual(itemNew.reserved, itemOld.reserved, `${caseName} item ${i}: reserved mismatch`);
        assert.strictEqual(itemNew.available, itemOld.available, `${caseName} item ${i}: available mismatch`);
        assert.strictEqual(itemNew.availability, itemOld.availability, `${caseName} item ${i}: availability mismatch`);
      }
      console.log(`  ✅ ${caseName} PASSED (100% Exact Equivalence)\n`);
    }

    // 1. No filters
    await assertEquivalence('1. No Filters', { page: 1, limit: 10 });

    // 2. Category filter
    await assertEquivalence('2. Category Filter', { categoryId: catB._id.toString(), page: 1, limit: 10 });

    // 3. Subcategory filter
    await assertEquivalence('3. Subcategory Filter', { subcategoryId: subB._id.toString(), page: 1, limit: 10 });

    // 4. Search query
    await assertEquivalence('4. Search Query', { search: 'Apple', page: 1, limit: 10 });

    // 5. Availability filter
    await assertEquivalence('5. Availability Filter (AVAILABLE)', { availability: 'AVAILABLE', page: 1, limit: 10 });
    await assertEquivalence('5b. Availability Filter (OUT_OF_STOCK)', { availability: 'OUT_OF_STOCK', page: 1, limit: 10 });

    // 6. Stock filter
    await assertEquivalence('6a. Stock Filter (in_stock)', { stockStatus: 'in_stock', page: 1, limit: 10 });
    await assertEquivalence('6b. Stock Filter (out_of_stock)', { stockStatus: 'out_of_stock', page: 1, limit: 10 });

    // 7. Pagination (page 2, limit 5)
    await assertEquivalence('7. Pagination (Page 2, Limit 5)', { page: 2, limit: 5 });

    // 8. Empty result
    await assertEquivalence('8. Empty Result', { search: 'NonExistentProductZ999', page: 1, limit: 10 });

    // 9. Multiple pages (page 1 vs page 2 vs page 3 ordering)
    await assertEquivalence('9a. Multiple Pages (Page 1)', { page: 1, limit: 8 });
    await assertEquivalence('9b. Multiple Pages (Page 2)', { page: 2, limit: 8 });
    await assertEquivalence('9c. Multiple Pages (Page 3)', { page: 3, limit: 8 });

    // 10. Seller isolation check
    const otherSellerId = new Types.ObjectId().toString();
    const otherRes = await SellerCatalogueService.listMyListings(otherSellerId, { page: 1, limit: 10 });
    assert.strictEqual(otherRes.items.length, 0, 'Seller isolation check: other seller must have 0 items');
    assert.strictEqual(otherRes.total, 0, 'Seller isolation check: other seller must have 0 total');
    console.log('  ✅ 10. Seller Isolation PASSED (0 items returned for other seller)\n');

    console.log('================================================================');
    console.log('   ALL 10 SELLER LISTING EQUIVALENCE TESTS PASSED (100%)       ');
    console.log('================================================================');

  } finally {
    console.log('Cleaning up test documents...');
    if (testListingIds.length) await SellerListing.deleteMany({ _id: { $in: testListingIds } });
    if (testProductIds.length) await MasterProduct.deleteMany({ _id: { $in: testProductIds } });
    if (catB.code === 'EQB02') await Category.deleteOne({ _id: catB._id });
    if (subB.slug === 'eq-sub-b') await Subcategory.deleteOne({ _id: subB._id });
    console.log('Cleanup finished.');
    await disconnectDatabase();
  }
}

runEquivalenceTests().catch((err) => {
  console.error('Equivalence test failed:', err);
  process.exit(1);
});
