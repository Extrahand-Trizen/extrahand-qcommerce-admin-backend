const mongoose = require('mongoose');

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });

  const targetNames = [
    'Grocery & Staples', 'Fruits & Vegetables', 'Dairy, Bread & Eggs', 'Snacks & Munchies',
    'Breakfast & Cereals', 'Ready-to-Eat & Packaged Food', 'Beverages', 'Home Cleaning & Laundry',
    'Personal Care', 'Beauty & Cosmetics', 'Baby Care', 'Pet Supplies', 'Health & Wellness',
    'Pharmacy & Medicines', 'Meat, Poultry & Seafood', 'Bakery & Sweets', 'Frozen Food & Ice Cream',
    'Kitchenware & Cookware', 'Home & Living', 'Electronics & Mobile Accessories', 'Stationery & Books',
    'Toys & Games', 'Fashion & Accessories', 'Footwear', 'Sports & Fitness', 'Automotive',
    'Flowers, Gifts & Celebration', 'Pooja & Religious', 'Restaurant & Food'
  ];

  let totalFromList = 0;
  let totalIn29Categories = 0;

  console.log('Category | Current Total Subcategories');
  console.log('----------------------------------------------------');

  for (let i = 0; i < targetNames.length; i++) {
    const name = targetNames[i];
    const cat = await mongoose.connection.collection('categories').findOne({ name });
    if (!cat) continue;
    const count = await mongoose.connection.collection('subcategories').countDocuments({ categoryId: cat._id });
    totalIn29Categories += count;
    console.log(`${(i + 1).toString().padStart(2, ' ')}. ${name.padEnd(35, ' ')} : ${count}`);
  }

  const overallSubcategories = await mongoose.connection.collection('subcategories').countDocuments();
  console.log('----------------------------------------------------');
  console.log(`Total across the 29 categories: ${totalIn29Categories}`);
  console.log(`Grand total in database: ${overallSubcategories}`);

  await mongoose.disconnect();
}

main().catch(console.error);
