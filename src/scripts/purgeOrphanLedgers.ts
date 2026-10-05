import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import SellerLedger from '../models/SellerLedger';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { Types } from 'mongoose';

async function purgeOrphanLedgers() {
  await connectDatabase();
  const sellerId = new Types.ObjectId('6ab23cd40cd2a7f5a4c71c4a');

  // Delete ALL SellerLedger entries for this seller
  const delRes = await SellerLedger.deleteMany({ sellerId });
  console.log(`🧹 Deleted ALL ${delRes.deletedCount} old/duplicate ledger entries for this seller.`);

  // Re-reconcile cleanly from actual CustomerOrders in DB
  await SellerLedgerService.reconcileSellerLedgers(sellerId);
  console.log('✅ Re-reconciled cleanly from current CustomerOrders.');

  const todayEarningsSummary = await SellerLedgerService.getTodayEarnings(sellerId);
  console.log('\n📊 CLEAN TODAY EARNINGS DTO:', JSON.stringify(todayEarningsSummary, null, 2));

  const earningsSummary = await SellerLedgerService.getEarningsSummary(sellerId);
  console.log('\n📊 CLEAN EARNINGS SUMMARY DTO:', JSON.stringify(earningsSummary, null, 2));

  await disconnectDatabase();
}

purgeOrphanLedgers().catch((err) => {
  console.error(err);
  process.exit(1);
});
