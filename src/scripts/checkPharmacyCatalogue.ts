import { connectDatabase, disconnectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';

async function run() {
  await connectDatabase();
  const cats = await Category.find({
    $or: [
      { slug: /pharmacy/i },
      { name: /pharmacy/i },
      { slug: /health/i },
      { name: /health/i },
    ],
  }).lean();

  console.log('Categories found:', cats.length);
  for (const c of cats) {
    console.log(`Cat: ${c.name} (${c._id})`);
    const subs = await Subcategory.find({ categoryId: c._id }).lean();
    console.log(`  Subcategories: ${subs.length}`);
    for (const s of subs) {
      const pts = await ProductType.find({ subcategoryId: s._id }).lean();
      console.log(`    Sub: ${s.name} (${s._id}) -> ProductTypes (${pts.length}):`, pts.map((p) => p.name).join(', '));
    }
  }

  await disconnectDatabase();
}

run();
