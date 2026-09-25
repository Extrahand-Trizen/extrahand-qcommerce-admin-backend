const mongoose = require('mongoose');

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });
  const db = mongoose.connection.db;

  const o = await db.collection('selleronboardings').findOne({ _id: new mongoose.Types.ObjectId('6ab6468aac6edb729157f2ff') });
  console.log('FULL SELLER ONBOARDING DOC FOR Check-in:');
  console.log(JSON.stringify(o, null, 2));

  const s = await db.collection('sellers').findOne({ _id: o.sellerId });
  console.log('SELLER DOC:');
  console.log(JSON.stringify(s, null, 2));

  await mongoose.disconnect();
}

main().catch(console.error);
