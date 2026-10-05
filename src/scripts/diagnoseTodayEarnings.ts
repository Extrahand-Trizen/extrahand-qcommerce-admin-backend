import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import SellerLedger from '../models/SellerLedger';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { getAsiaKolkataDayBounds } from '../utils/istDay';
import { Types } from 'mongoose';

async function diagnoseTodayOrders() {
  await connectDatabase();
  const sellerId = new Types.ObjectId('6ab23cd40cd2a7f5a4c71c4a');

  const { startOfDay, endOfDay } = getAsiaKolkataDayBounds();
  console.log('Today IST Day Bounds:', startOfDay.toISOString(), 'to', endOfDay.toISOString());

  // 1. Fetch all orders created today
  const todayOrders = await CustomerOrder.find({
    sellerId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  }).lean();

  console.log(`\n📦 CustomerOrders Created Today (${todayOrders.length}):`);
  todayOrders.forEach((o) => {
    console.log(` - Order #${o.orderNumber} | Status: ${o.status} | FulfillmentStatus: ${o.fulfillmentStatus} | Amount: ₹${o.amountPaise / 100} | ItemTotal: ₹${(o.itemTotalPaise || 0) / 100} | CompletedAt: ${o.completedAt?.toISOString() || 'NONE'} | CreatedAt: ${o.createdAt.toISOString()}`);
  });

  // 2. Fetch all completed/sold orders regardless of date
  const allSoldOrders = await CustomerOrder.find({
    sellerId,
    $or: [
      { fulfillmentStatus: { $in: ['COMPLETED', 'HANDED_OVER', 'DELIVERED'] } },
      { status: { $in: ['completed', 'COMPLETED', 'DELIVERED', 'PAID'] } },
    ],
  }).lean();

  console.log(`\n🛒 Total Sold/Completed CustomerOrders in DB (${allSoldOrders.length})`);

  // 3. Reconcile
  await SellerLedgerService.reconcileSellerLedgers(sellerId);

  // 4. Fetch SellerLedger entries created/completed today
  const todayLedgers = await SellerLedger.find({
    sellerId,
    $or: [
      { completedAt: { $gte: startOfDay, $lte: endOfDay } },
      { createdAt: { $gte: startOfDay, $lte: endOfDay } },
    ],
  }).lean();

  console.log(`\n💳 SellerLedger Entries Created/Completed Today (${todayLedgers.length}):`);
  todayLedgers.forEach((l) => {
    console.log(` - Order #${l.orderNumber} | Type: ${l.transactionType} | Status: ${l.status} | Gross: ₹${l.grossAmountPaise / 100} | Net: ₹${l.netAmountPaise / 100} | CompletedAt: ${l.completedAt?.toISOString() || 'NONE'}`);
  });

  const todayEarningsSummary = await SellerLedgerService.getTodayEarnings(sellerId);
  console.log('\n📊 TODAY EARNINGS DTO RESULT:', JSON.stringify(todayEarningsSummary, null, 2));

  await disconnectDatabase();
}

diagnoseTodayOrders().catch((err) => {
  console.error(err);
  process.exit(1);
});
