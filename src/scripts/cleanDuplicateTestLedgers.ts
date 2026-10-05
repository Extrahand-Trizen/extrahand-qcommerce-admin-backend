import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import SellerLedger from '../models/SellerLedger';
import CustomerOrder from '../models/CustomerOrder';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { Types } from 'mongoose';

async function cleanDuplicateTestLedgers() {
  await connectDatabase();
  const sellerId = new Types.ObjectId('6ab23cd40cd2a7f5a4c71c4a');

  // Delete all SellerLedger entries for QC-OCT4- test orders so we have clean records
  const deletedRes = await SellerLedger.deleteMany({
    sellerId,
    orderNumber: /^QC-OCT4-/,
  });
  console.log(`🧹 Deleted ${deletedRes.deletedCount} old test ledger entries for Oct 4.`);

  // Also clean up any orders without valid orderNumber or duplicate test ledgers
  const completedOrders = await CustomerOrder.find({
    sellerId,
    orderNumber: /^QC-OCT4-/,
  }).lean();

  console.log(`Re-reconciling ${completedOrders.length} Oct 4 test orders...`);
  for (const o of completedOrders) {
    await SellerLedgerService.recordOrderCompletion(o);
  }

  // Update Oct 4 ledger entries status to SETTLED so they don't block
  await SellerLedger.updateMany(
    { sellerId, orderNumber: /^QC-OCT4-/ },
    { $set: { status: 'SETTLED', settledAt: new Date('2026-10-04T18:00:00.000Z') } },
  );

  const summary = await SellerLedgerService.getTodayEarnings(sellerId);
  console.log('\n📊 TODAY EARNINGS (AFTER FIX):', JSON.stringify(summary, null, 2));

  await disconnectDatabase();
}

cleanDuplicateTestLedgers().catch((err) => {
  console.error(err);
  process.exit(1);
});
