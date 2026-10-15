import mongoose from 'mongoose';

async function main() {
  await mongoose.connect('mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority');
  const db = mongoose.connection.db!;
  const coll = db.collection('inappnotifications');

  // Check recent notifications for test users
  const recent = await coll.find().sort({ createdAt: -1 }).limit(15).toArray();
  console.log('--- 15 Most Recent Notifications in Platform DB ---');
  for (const n of recent) {
    console.log(`[${n._id}] userId=${n.userId} title="${n.title}" body="${n.body}" role=${n.data?.recipientRole || 'none'} eventKey=${n.data?.eventKey || 'none'} createdAt=${n.createdAt}`);
  }

  // Check how many have recipientRole: 'seller'
  const sellerRoleCount = await coll.countDocuments({ 'data.recipientRole': 'seller' });
  const qcEventsCount = await coll.countDocuments({
    'data.eventKey': {
      $in: [
        'QC_ORDER_PLACED',
        'QC_ORDER_AUTO_REJECTED',
        'QC_SHOP_AUTO_PAUSED',
        'QC_SHOP_REOPENED',
        'QC_STOCK_OUT',
      ],
    },
  });
  console.log(`\nSeller role tagged: ${sellerRoleCount}`);
  console.log(`QC eventKey tagged: ${qcEventsCount}`);

  await mongoose.disconnect();
}

main().catch(console.error);
