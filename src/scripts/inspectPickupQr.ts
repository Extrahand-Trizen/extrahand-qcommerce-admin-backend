/**
 * Diagnostic: pickup-QR coverage for a seller's orders. Read-only.
 *   npx ts-node src/scripts/inspectPickupQr.ts 9999999999
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import CustomerOrder from '../models/CustomerOrder';
import OrderPickupQR from '../models/OrderPickupQR';
import { env } from '../config/env';
import { phoneVariants } from '../utils/phone';

async function main() {
  const phone = process.argv[2];
  if (!phone) throw new Error('usage: inspectPickupQr.ts <phone>');
  await connectDatabase();

  console.log('PICKUP_QR_SECRET set:', env.PICKUP_QR_SECRET ? `yes (len ${env.PICKUP_QR_SECRET.trim().length})` : 'NO ❌');

  const seller = await Seller.findOne({
    mobileNumber: { $in: phoneVariants(phone) },
    status: { $ne: 'DELETED' },
  }).lean();
  if (!seller) throw new Error('no seller for ' + phone);
  console.log('seller', String(seller._id), seller.mobileNumber);

  const orders = await CustomerOrder.find({ sellerId: seller._id })
    .select('orderNumber status fulfillmentStatus readyAt createdAt')
    .sort({ createdAt: -1 })
    .lean();

  console.log(`\n${orders.length} orders:\n`);
  for (const o of orders) {
    const qrs = await OrderPickupQR.find({ orderId: o._id }).select('status createdAt revokedReason').sort({ createdAt: -1 }).lean();
    const active = qrs.filter((q) => q.status === 'ACTIVE').length;
    const flag =
      ['READY'].includes(String(o.fulfillmentStatus)) && active === 0 ? '  ⚠️ READY but NO ACTIVE QR' : '';
    console.log(
      `${String(o.orderNumber).padEnd(18)} fulfil:${String(o.fulfillmentStatus).padEnd(12)} ` +
      `QRs:[${qrs.map((q) => q.status).join(',') || 'none'}] active:${active}${flag}`,
    );
  }

  await disconnectDatabase();
}

main().catch((e) => { console.error(e); process.exit(1); });
