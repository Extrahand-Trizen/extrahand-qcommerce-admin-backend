import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import SellerLedger from '../models/SellerLedger';
import { getAsiaKolkataDayBounds } from '../utils/istDay';
import { Types } from 'mongoose';

async function checkTodayDetail() {
  await connectDatabase();
  const sellerId = new Types.ObjectId('6ab23cd40cd2a7f5a4c71c4a');
  const { startOfDay, endOfDay } = getAsiaKolkataDayBounds();

  const orders = await CustomerOrder.find({
    sellerId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  }).lean();

  console.log(`\n📦 TODAY CUSTOMER ORDERS (${orders.length}):`);
  orders.forEach((o) => {
    console.log(
      ` - Order: ${o.orderNumber} | Status: ${o.status} | Fulfillment: ${o.fulfillmentStatus} | ItemTotal: ₹${(o.itemTotalPaise || 0) / 100} | Total: ₹${(o.amountPaise || 0) / 100} | CreatedAt: ${o.createdAt.toISOString()}`,
    );
  });

  const ledgers = await SellerLedger.find({
    sellerId,
    $or: [
      { completedAt: { $gte: startOfDay, $lte: endOfDay } },
      { createdAt: { $gte: startOfDay, $lte: endOfToday(startOfDay) } },
    ],
  }).lean();

  console.log(`\n💳 TODAY LEDGERS (${ledgers.length}):`);
  ledgers.forEach((l) => {
    console.log(
      ` - Ledger: ${l.orderNumber} | Type: ${l.transactionType} | Status: ${l.status} | Gross: ₹${l.grossAmountPaise / 100} | Net: ₹${l.netAmountPaise / 100} | CompletedAt: ${l.completedAt?.toISOString() || 'NONE'} | CreatedAt: ${l.createdAt.toISOString()}`,
    );
  });

  await disconnectDatabase();
}

function endOfToday(start: Date) {
  const d = new Date(start);
  d.setHours(23, 59, 59, 999);
  return d;
}

checkTodayDetail().catch((err) => {
  console.error(err);
  process.exit(1);
});
