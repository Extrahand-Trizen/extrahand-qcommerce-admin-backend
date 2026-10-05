import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import SellerLedger from '../models/SellerLedger';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { Types } from 'mongoose';

async function forceAvailable() {
  await connectDatabase();
  const sellerId = new Types.ObjectId('6ab23cd40cd2a7f5a4c71c4a');

  // Find all Oct 4 test orders
  const orders = await CustomerOrder.find({ sellerId, orderNumber: /^QC-OCT4-/ }).lean();

  for (const o of orders) {
    const existing = await SellerLedger.findOne({ sellerId, orderId: o._id });
    if (!existing) {
      await SellerLedgerService.recordOrderCompletion(o);
    }
  }

  // Update all Oct 4 order ledger entries to AVAILABLE
  const oct4OrderIds = orders.map((o) => o._id);
  const updated = await SellerLedger.updateMany(
    { sellerId, orderId: { $in: oct4OrderIds } },
    { $set: { status: 'AVAILABLE' } },
  );

  console.log(`Updated ${updated.modifiedCount} Oct 4 ledger entries directly to AVAILABLE.`);

  const summary = await SellerLedgerService.getEarningsSummary(sellerId);
  console.log('Available Payout (Rupees):', summary.availablePayoutRupees);

  await disconnectDatabase();
}

forceAvailable().catch((err) => {
  console.error(err);
  process.exit(1);
});
