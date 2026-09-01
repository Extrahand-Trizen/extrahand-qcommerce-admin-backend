/**
 * Catalogue V2 migration — one-time, idempotent.
 *
 * 1. Backfill Category.code (SKU prefix)
 * 2. Backfill MasterProduct.sellingPricePaise (from the cheapest linked listing, else 0)
 * 3. SellerListing: sellingPrice -> sellingPricePaise (x100), compareAtPrice -> compareAtPricePaise
 * 4. SellerListing.availability: UNAVAILABLE -> OUT_OF_STOCK
 * 5. SellerListing.reviewStatus: default APPROVED
 * 6. ProductTypeAttribute: flag the pack/variant attributes (+ variantOrder)
 *
 * Run:  npx ts-node src/scripts/migrateCatalogueV2.ts
 */
import { connectDatabase } from '../config/database';
import Category from '../models/Category';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import Attribute from '../models/Attribute';
import ProductTypeAttribute from '../models/ProductTypeAttribute';

/** Fixed codes for the 9 seeded categories (by slug). */
const CATEGORY_CODES: Record<string, string> = {
  fresh: 'FRESH',
  grocery: 'GROC',
  snacks: 'SNACK',
  beauty: 'BEAUTY',
  health: 'HEALTH',
  baby: 'BABY',
  home: 'HOME',
  fashion: 'FASH',
  pet: 'PET',
};

/** Slugify-ish fallback for any category not in the map above. */
function fallbackCode(name: string): string {
  return name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5) || 'CAT';
}

/** order-0 candidates, most-preferred first. `unit` is always order 1. */
const VARIANT_PRIMARY_KEYS = [
  'net_quantity',
  'quantity',
  'weight',
  'pack_size',
  'pieces',
  'size',
  'capacity',
  'serving_size',
  'variant',
];

async function migrateCategoryCodes() {
  const cats = await Category.find({});
  let n = 0;
  for (const cat of cats) {
    if (cat.code) continue;
    const code = CATEGORY_CODES[cat.slug] || fallbackCode(cat.name);
    cat.code = code;
    await cat.save();
    n += 1;
    console.log(`  code: ${cat.name} -> ${code}`);
  }
  console.log(`Category codes backfilled: ${n}`);
}

async function migrateListingsAndPrices() {
  const raw = SellerListing.collection;
  const listings = (await raw.find({}).toArray()) as Array<Record<string, unknown>>;
  let converted = 0;

  // cheapest listing price per master product (in paise)
  const cheapestPaiseByProduct = new Map<string, number>();

  for (const l of listings) {
    const oldPrice = l.sellingPrice;
    const sellingPricePaise =
      typeof oldPrice === 'number'
        ? Math.round(oldPrice * 100)
        : typeof l.sellingPricePaise === 'number'
          ? l.sellingPricePaise
          : 0;

    const oldCompare = l.compareAtPrice;
    const compareAtPricePaise =
      typeof oldCompare === 'number'
        ? Math.round(oldCompare * 100)
        : typeof l.compareAtPricePaise === 'number'
          ? l.compareAtPricePaise
          : undefined;

    const availability =
      l.availability === 'UNAVAILABLE'
        ? 'OUT_OF_STOCK'
        : typeof l.availability === 'string'
          ? l.availability
          : 'AVAILABLE';

    await raw.updateOne(
      { _id: l._id as object },
      {
        $set: {
          sellingPricePaise,
          ...(compareAtPricePaise != null ? { compareAtPricePaise } : {}),
          availability,
          reviewStatus: (l.reviewStatus as string) ?? 'APPROVED',
        },
        $unset: { sellingPrice: '', compareAtPrice: '' },
      },
    );
    converted += 1;

    const pid = String(l.masterProductId);
    const prev = cheapestPaiseByProduct.get(pid);
    if (prev == null || sellingPricePaise < prev) {
      cheapestPaiseByProduct.set(pid, sellingPricePaise);
    }
  }
  console.log(`Seller listings converted to paise: ${converted}`);

  // backfill MasterProduct.sellingPricePaise
  const products = (await MasterProduct.collection.find({}).toArray()) as Array<Record<string, unknown>>;
  let priced = 0;
  for (const p of products) {
    if (typeof p.sellingPricePaise === 'number') continue;
    const paise = cheapestPaiseByProduct.get(String(p._id)) ?? 0;
    await MasterProduct.collection.updateOne(
      { _id: p._id as object },
      { $set: { sellingPricePaise: paise } },
    );
    priced += 1;
    if (paise === 0) console.warn(`  ! no listing price for "${String(p.name)}" — set to 0, fix in admin`);
  }
  console.log(`Master products priced: ${priced}`);
}

async function migrateVariantFlags() {
  const attrs = await Attribute.find({}).select('_id key');
  const keyById = new Map(attrs.map((a) => [a._id.toString(), a.key]));
  const idByKey = new Map(attrs.map((a) => [a.key, a._id.toString()]));

  const links = await ProductTypeAttribute.find({});
  const byType = new Map<string, typeof links>();
  for (const link of links) {
    const t = link.productTypeId.toString();
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(link);
  }

  let flagged = 0;
  for (const [, typeLinks] of byType) {
    // pick the single best primary key present for this product type
    const primaryKey = VARIANT_PRIMARY_KEYS.find((k) =>
      typeLinks.some((l) => keyById.get(l.attributeId.toString()) === k),
    );
    const primaryAttrId = primaryKey ? idByKey.get(primaryKey) : undefined;
    const unitAttrId = idByKey.get('unit');

    for (const link of typeLinks) {
      const aid = link.attributeId.toString();
      const isPrimary = primaryAttrId != null && aid === primaryAttrId;
      const isUnit = unitAttrId != null && aid === unitAttrId;
      const shouldFlag = isPrimary || isUnit;
      const order = isPrimary ? 0 : 1;

      if (link.isVariantAttribute !== shouldFlag || link.variantOrder !== order) {
        link.isVariantAttribute = shouldFlag;
        link.variantOrder = order;
        await link.save();
        if (shouldFlag) flagged += 1;
      }
    }
  }
  console.log(`Product-type variant attributes flagged: ${flagged}`);
}

async function main() {
  await connectDatabase();
  console.log('--- Catalogue V2 migration ---');
  await migrateCategoryCodes();
  await migrateListingsAndPrices();
  await migrateVariantFlags();
  console.log('--- done ---');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
