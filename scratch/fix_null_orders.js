const mongoose = require('mongoose');

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });

  const subs = await mongoose.connection.collection('subcategories').find({
    $or: [{ displayOrder: null }, { displayOrder: { $exists: false } }, { displayOrder: { $gte: 20 } }]
  }).toArray();

  console.log('Fixing display order for:', subs.length, 'subcategories');
  for (const s of subs) {
    const randomOrder = Math.floor(Math.random() * 19) + 1;
    await mongoose.connection.collection('subcategories').updateOne(
      { _id: s._id },
      { $set: { displayOrder: randomOrder } }
    );
    console.log(`Updated "${s.name}" -> displayOrder: ${randomOrder}`);
  }

  // Also check if any category has null displayOrder
  const cats = await mongoose.connection.collection('categories').find({
    $or: [{ displayOrder: null }, { displayOrder: { $exists: false } }]
  }).toArray();
  for (const c of cats) {
    console.log(`Category with null order: ${c.name}`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
