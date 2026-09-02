import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import ProductImage from '../models/ProductImage';
import MasterProduct from '../models/MasterProduct';
import { FRESH_FRUITS_VEG_MASTER_PRODUCTS } from '../data/masterProductsSeed';

const BAD_URL_PATTERN = /encrypted-tbn\d*\.gstatic\.com/i;

const IMAGE_BY_KEYWORD: Array<{ keywords: string[]; imageUrl: string }> = [
  { keywords: ['apple'], imageUrl: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=400&q=80' },
  { keywords: ['banana'], imageUrl: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=400&q=80' },
  { keywords: ['mango'], imageUrl: 'https://images.unsplash.com/photo-1553279768-8650a289d6f3?auto=format&fit=crop&w=400&q=80' },
  { keywords: ['milk', 'curd', 'dairy', 'yogurt'], imageUrl: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?auto=format&fit=crop&w=400&q=80' },
  { keywords: ['rice'], imageUrl: 'https://images.unsplash.com/photo-1586201375767-2aef05dbad7a?auto=format&fit=crop&w=400&q=80' },
  { keywords: ['dragon fruit', 'dragonfruit'], imageUrl: 'https://images.unsplash.com/photo-1527325241048-218f986a455c?auto=format&fit=crop&w=400&q=80' },
  { keywords: ['sun screen', 'sunscreen', 'spf'], imageUrl: 'https://images.unsplash.com/photo-1556228578-0d47bdefe7f6?auto=format&fit=crop&w=400&q=80' },
  { keywords: ['child powder', 'baby powder', 'talcum', 'talc'], imageUrl: 'https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=400&q=80' },
];

const IMAGE_BY_SKU = Object.fromEntries(
  FRESH_FRUITS_VEG_MASTER_PRODUCTS.filter((p) => p.imageUrl).map((p) => [p.sku, p.imageUrl!]),
);

function resolveImageUrl(name: string, sku: string): string | undefined {
  if (IMAGE_BY_SKU[sku]) return IMAGE_BY_SKU[sku];
  const haystack = `${name} ${sku}`.toLowerCase();
  for (const entry of IMAGE_BY_KEYWORD) {
    if (entry.keywords.some((kw) => haystack.includes(kw))) return entry.imageUrl;
  }
  return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80';
}

async function repairBrokenProductImages() {
  await connectDatabase();

  const images = await ProductImage.find().lean();
  let repaired = 0;

  for (const image of images) {
    const url = image.imageUrl?.trim() ?? '';
    const broken = !url || BAD_URL_PATTERN.test(url);
    if (!broken) continue;

    const product = await MasterProduct.findById(image.masterProductId).select('name sku').lean();
    if (!product) continue;

    const nextUrl = resolveImageUrl(product.name, product.sku);
    await ProductImage.updateOne({ _id: image._id }, { imageUrl: nextUrl, altText: product.name });
    console.log(`  ✓ ${product.name} → ${nextUrl}`);
    repaired += 1;
  }

  console.log(`\nRepaired ${repaired} broken product image(s).`);
  await mongoose.disconnect();
}

repairBrokenProductImages().catch((err) => {
  console.error(err);
  process.exit(1);
});
