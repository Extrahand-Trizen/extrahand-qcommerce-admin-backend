const mongoose = require('mongoose');

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });

  const sellers = await mongoose.connection.collection('sellers').find({
    mobileNumber: /0955/
  }).toArray();

  console.log('Found sellers matching 0955:', sellers.length);
  for (const s of sellers) {
    console.log('Seller:', s._id, s.mobileNumber, s.fullName, s.userId, s.status, s.onboardingStatus);
    const ob = await mongoose.connection.collection('selleronboardings').findOne({ sellerId: s._id });
    console.log('  Onboarding:', ob ? { _id: ob._id, status: ob.status, shopName: ob.shopName } : 'None');
  }

  await mongoose.disconnect();
}

main().catch(console.error);
