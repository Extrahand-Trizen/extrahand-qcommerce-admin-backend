import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import SellerPayout from '../models/SellerPayout';
import { SellerPayoutService } from '../services/SellerPayoutService';
import { Types } from 'mongoose';

async function finalizeLatestPayout() {
  await connectDatabase();
  const sellerId = new Types.ObjectId('6ab23cd40cd2a7f5a4c71c4a');

  // Find the latest processing payout for this seller
  const latestPayout = await SellerPayout.findOne({ sellerId, status: 'PROCESSING' }).sort({ createdAt: -1 });

  if (!latestPayout) {
    console.log('No pending PROCESSING payout found to finalize.');
  } else {
    console.log(`Finalizing payout ${latestPayout.payoutId} of ₹${latestPayout.amountPaise / 100}...`);
    const result = await SellerPayoutService.finalizePayout(latestPayout.payoutId, true, `REF-${Date.now()}`);
    console.log(`✅ Payout ${result.payoutId} finalized with status: ${result.status}`);
  }

  await disconnectDatabase();
}

finalizeLatestPayout().catch((err) => {
  console.error(err);
  process.exit(1);
});
