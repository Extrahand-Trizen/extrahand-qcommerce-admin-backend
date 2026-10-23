import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import MasterProduct from '../models/MasterProduct';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'extrahand' });
  console.log('Connected to MongoDB');

  // 1. Categories
  const medCatResult = await Category.updateMany(
    { $or: [{ code: 'MED' }, { slug: 'pharmacy-medicines' }] },
    { $set: { vertical: 'MEDICAL' } },
  );
  console.log('Medical categories updated:', medCatResult.modifiedCount);

  const kiranaCatResult = await Category.updateMany(
    { code: { $ne: 'MED' }, slug: { $ne: 'pharmacy-medicines' }, vertical: { $exists: false } },
    { $set: { vertical: 'KIRANA' } },
  );
  console.log('Kirana categories backfilled:', kiranaCatResult.modifiedCount);

  // Find the medical category ID
  const medCategory = await Category.findOne({ $or: [{ code: 'MED' }, { slug: 'pharmacy-medicines' }] }).lean();

  if (medCategory) {
    // 2. Subcategories
    const medSubResult = await Subcategory.updateMany(
      { categoryId: medCategory._id },
      { $set: { vertical: 'MEDICAL' } },
    );
    console.log('Medical subcategories updated:', medSubResult.modifiedCount);

    const kiranaSubResult = await Subcategory.updateMany(
      { categoryId: { $ne: medCategory._id }, vertical: { $exists: false } },
      { $set: { vertical: 'KIRANA' } },
    );
    console.log('Kirana subcategories backfilled:', kiranaSubResult.modifiedCount);

    // 3. ProductTypes
    const medPtResult = await ProductType.updateMany(
      { categoryId: medCategory._id },
      { $set: { vertical: 'MEDICAL' } },
    );
    console.log('Medical product types updated:', medPtResult.modifiedCount);

    const kiranaPtResult = await ProductType.updateMany(
      { categoryId: { $ne: medCategory._id }, vertical: { $exists: false } },
      { $set: { vertical: 'KIRANA' } },
    );
    console.log('Kirana product types backfilled:', kiranaPtResult.modifiedCount);

    // 4. MasterProducts
    const medMpResult = await MasterProduct.updateMany(
      { categoryId: medCategory._id },
      { $set: { vertical: 'MEDICAL', isMedicalProduct: true } },
    );
    console.log('Medical master products updated:', medMpResult.modifiedCount);

    const kiranaMpResult = await MasterProduct.updateMany(
      { categoryId: { $ne: medCategory._id } },
      { $set: { vertical: 'KIRANA', isMedicalProduct: false } },
    );
    console.log('Kirana master products updated:', kiranaMpResult.modifiedCount);
  }

  console.log('Backfill completed successfully!');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
