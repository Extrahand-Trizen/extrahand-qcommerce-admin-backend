const mongoose = require('mongoose');

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });
  const db = mongoose.connection.db;

  console.log('Connected to DB');

  const onboardings = await db.collection('selleronboardings')
    .find({})
    .sort({ updatedAt: -1, _id: -1 })
    .limit(5)
    .toArray();

  console.log(`Found ${onboardings.length} recent onboardings:`);
  for (const o of onboardings) {
    console.log('----------------------------------------------------');
    console.log(`ID: ${o._id}, SellerId: ${o.sellerId}, Shop: "${o.shopName}", Owner: "${o.fullName}"`);
    console.log(`Status: ${o.status}, Created: ${o.createdAt}, Updated: ${o.updatedAt}`);
    console.log(`Aadhaar Number: ${o.aadhaarNumber}`);
    console.log(`Aadhaar Status: ${o.aadhaarVerificationStatus}`);
    console.log(`Aadhaar Verified At: ${o.aadhaarVerifiedAt}`);
    console.log(`PAN: ${o.pan || o.panNumber}, Status: ${o.panVerificationStatus}`);
    console.log(`Bank Account in Onboarding:`, JSON.stringify(o.bankAccount, null, 2));

    const docs = await db.collection('sellerdocuments').find({ sellerId: o.sellerId }).toArray();
    console.log(`Seller Documents count: ${docs.length}`);
    for (const d of docs) {
      console.log(`  - DocType: ${d.documentType}, File: ${d.fileName}, Status: ${d.verificationStatus}, URL: ${d.fileUrl}`);
    }

    const settings = await db.collection('sellerstoresettings').findOne({ sellerId: o.sellerId });
    console.log(`Bank in Store Settings:`, JSON.stringify(settings?.bankAccount, null, 2));
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
