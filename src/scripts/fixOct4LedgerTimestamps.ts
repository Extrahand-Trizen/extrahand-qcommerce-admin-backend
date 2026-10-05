import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import SellerLedger from '../models/SellerLedger';
import CustomerOrder from '../models/CustomerOrder';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { Types } from 'mongoose';

async function fixOct4LedgerCompletedAt() {
  await connectDatabase();
  const sellerId = new Types.ObjectId('6ab23cd40cd2a7f5a4c71c4a');

  // Find all Oct 4 customer orders and update their corresponding SellerLedger completedAt
  const oct4Orders = await CustomerOrder.find({ sellerId, orderNumber: /^QC-OCT4-/ }).lean();

  for (const o of oct4Orders) {
    await SellerLedger.updateMany(
      { sellerId, orderId: o._id },
      { $set: { completedAt: o.createdAt } },
    );
  }

  // Also fix any remaining QC-OCT4- entries in SellerLedger
  await SellerLedger.updateMany(
    { sellerId, orderNumber: /^QC-OCT4-/ },
    { $set: { completedAt: new Date('2026-10-04T12:00:00.000Z') } },
  );

  console.log('✅ Fixed completedAt timestamps on Oct 4 test ledgers.');

  const todayEarningsSummary = await SellerLedgerService.getTodayEarnings(sellerId);
  console.log('\n📊 TODAY EARNINGS DTO (STRICTLY TODAY):', JSON.stringify(todayEarningsSummary, null, 2));

  await disconnectDatabase();
}

fixOct4LedgerCompletedAt().catch((err) => {
  console.error(err);
  process.exit(1);
});
