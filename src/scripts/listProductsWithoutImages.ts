import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import MasterProduct from '../models/MasterProduct';
import ProductImage from '../models/ProductImage';

async function main() {
  await connectDatabase();

  const products = await MasterProduct.find({ status: 'ACTIVE' })
    .select('name sku brand slug')
    .lean();

  const imageCounts = await ProductImage.aggregate([
    { $group: { _id: '$masterProductId', count: { $sum: 1 } } },
  ]);

  const imageMap = new Map(imageCounts.map((r) => [r._id.toString(), r.count as number]));

  const withoutImages = products.filter((p) => !imageMap.has(p._id.toString()));

  console.log('Total products:', products.length);
  console.log('Without images:', withoutImages.length);
  console.log('---');
  for (const p of withoutImages) {
    console.log(`${p.sku} | ${p.name}${p.brand ? ` (${p.brand})` : ''}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
