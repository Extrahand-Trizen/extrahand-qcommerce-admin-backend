const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(
    'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/extrahand?retryWrites=true&w=majority&appName=Cluster0',
  );
  const doc = await mongoose.connection.db.collection('customerorders').findOne(
    { orderNumber: 'QC-MTWRQFER-S7D9' },
    { projection: { shopLocation: 1, shopName: 1, sellerId: 1 } },
  );
  console.log(JSON.stringify(doc, null, 2));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
