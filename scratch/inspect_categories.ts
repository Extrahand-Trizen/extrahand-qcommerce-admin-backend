import mongoose from 'mongoose';
import Category from '../src/models/Category';
import Subcategory from '../src/models/Subcategory';

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });
  console.log('Connected to MongoDB');

  const categories = await Category.find({}).sort({ displayOrder: 1, name: 1 });
  console.log(`Found ${categories.length} categories in database:`);
  for (const cat of categories) {
    const subCount = await Subcategory.countDocuments({ categoryId: cat._id });
    console.log(`- [${cat.code}] "${cat.name}" (slug: ${cat.slug}, order: ${cat.displayOrder}) -> ${subCount} subcategories`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
