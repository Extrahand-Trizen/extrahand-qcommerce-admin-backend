import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';
import { FRESH_FRUITS_VEG_MASTER_PRODUCTS } from '../data/masterProductsSeed';

/** Curated product image URLs (Unsplash, stable HTTPS). */
const IMAGE_BY_KEYWORD: Array<{ keywords: string[]; imageUrl: string }> = [
  {
    keywords: ['apple'],
    imageUrl: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['banana'],
    imageUrl: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['mango'],
    imageUrl: 'https://images.unsplash.com/photo-1553279768-8650a289d6f3?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['milk', 'curd', 'dairy', 'yogurt'],
    imageUrl: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['rice'],
    imageUrl: 'https://images.unsplash.com/photo-1586201375767-2aef05dbad7a?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['dragon fruit', 'dragonfruit'],
    imageUrl: 'https://images.unsplash.com/photo-1527325241048-218f986a455c?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['sun screen', 'sunscreen', 'spf'],
    imageUrl: 'https://images.unsplash.com/photo-1556228578-0d47bdefe7f6?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['child powder', 'baby powder', 'talcum', 'talc'],
    imageUrl: 'https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['orange'],
    imageUrl: 'https://images.unsplash.com/photo-1547514704-6f0f5c0e72a4?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['tomato'],
    imageUrl: 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['potato'],
    imageUrl: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=400&q=80',
  },
  {
    keywords: ['onion'],
    imageUrl: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?auto=format&fit=crop&w=400&q=80',
  },
];

/** SKU-level overrides when keyword matching is ambiguous. */
const IMAGE_BY_SKU: Record<string, string> = Object.fromEntries(
  FRESH_FRUITS_VEG_MASTER_PRODUCTS.filter((p) => p.imageUrl).map((p) => [p.sku, p.imageUrl!])
);

function resolveImageUrl(name: string, sku: string): string | undefined {
  if (IMAGE_BY_SKU[sku]) return IMAGE_BY_SKU[sku];

  const haystack = `${name} ${sku}`.toLowerCase();

  for (const entry of IMAGE_BY_KEYWORD) {
    if (entry.keywords.some((kw) => haystack.includes(kw))) {
      return entry.imageUrl;
    }
  }

  return undefined;
}

async function backfillProductImages() {
  await connectDatabase();

  const products = await MasterProduct.find({ status: 'ACTIVE' }).lean();
  const imageCounts = await ProductImage.aggregate([
    { $group: { _id: '$masterProductId', count: { $sum: 1 } } },
  ]);
  const imageMap = new Map(imageCounts.map((r) => [r._id.toString(), r.count as number]));

  const withoutImages = products.filter((p) => !imageMap.has(p._id.toString()));

  if (!withoutImages.length) {
    console.log('All products already have images.');
    await mongoose.disconnect();
    return;
  }

  let added = 0;
  let skipped = 0;

  for (const product of withoutImages) {
    const imageUrl = resolveImageUrl(product.name, product.sku);

    if (!imageUrl) {
      console.warn(`  ✗ No image found for: ${product.sku} | ${product.name}`);
      skipped += 1;
      continue;
    }

    await ProductImage.create({
      masterProductId: product._id,
      imageUrl,
      altText: product.name,
      displayOrder: 0,
      isPrimary: true,
    });

    console.log(`  ✓ ${product.name} → ${imageUrl}`);
    added += 1;
  }

  console.log(`\nDone: ${added} images added, ${skipped} skipped.`);
  await mongoose.disconnect();
}

backfillProductImages().catch((err) => {
  console.error(err);
  process.exit(1);
});
