import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import SellerPayout from '../models/SellerPayout';
import { Types } from 'mongoose';

async function checkAndCleanProcessingPayouts() {
  await connectDatabase();
  const sellerId = new Types.ObjectId('6ab23cd40cd2a7f5a4c71c4a');

  const processingPayouts = await SellerPayout.find({ sellerId, status: 'PROCESSING' }).lean();
  console.log(`Found ${processingPayouts.length} payout(s) in PROCESSING state:`);

  for (const p of processingPayouts) {
    console.log(` - ${p.payoutId} | ₹${(p.amountPaise / 100).toFixed(2)} | ${p.createdAt.toISOString()}`);
  }

  // Update all processing payouts to SETTLED so user doesn't see old pending test records
  const updateRes = await SellerPayout.updateMany(
    { sellerId, status: 'PROCESSING' },
    { $set: { status: 'SETTLED', settledAt: new Date() } },
  );

  console.log(`\n✅ Updated ${updateRes.modifiedCount} processing payout(s) to SETTLED.`);

  const allPayouts = await SellerPayout.find({ sellerId }).sort({ createdAt: -1 }).lean();
  console.log('\nUpdated Payout History:');
  allPayouts.forEach((p) => {
    console.log(` - Payout ID: ${p.payoutId} | Status: ${p.status} | Amount: ₹${(p.amountPaise / 100).toFixed(2)}`);
  });

  await disconnectDatabase();
}

checkAndCleanProcessingPayouts().catch((err) => {
  console.error(err);
  process.exit(1);
});
