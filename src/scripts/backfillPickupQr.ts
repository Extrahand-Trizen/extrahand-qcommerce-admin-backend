/**
 * Mint an Order Pickup QR for every order currently sitting in fulfillmentStatus
 * READY that doesn't already have an ACTIVE one. Run once after deploying the
 * pickup-QR feature so in-flight READY orders can still be handed over.
 *   npx ts-node src/scripts/backfillPickupQr.ts [--dry]
 *
 * Requires PICKUP_QR_SECRET.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import OrderPickupQR from '../models/OrderPickupQR';
import { OrderPickupService } from '../services/OrderPickupService';
import { env } from '../config/env';

async function main() {
  if (!env.PICKUP_QR_SECRET) {
    console.error('PICKUP_QR_SECRET is not set — cannot mint QRs.');
    process.exit(1);
  }
  const dry = process.argv.includes('--dry');
  await connectDatabase();

  const readyOrders = await CustomerOrder.find({
    fulfillmentStatus: 'READY',
    status: { $nin: ['CANCELLED', 'FAILED', 'DELIVERED'] },
  })
    .select('_id sellerId orderNumber')
    .lean();

  console.log(`${readyOrders.length} READY order(s) found${dry ? '  (dry run)' : ''}`);
  let minted = 0;
  let skipped = 0;

  for (const order of readyOrders) {
    if (!order.sellerId) { skipped += 1; continue; }
    const existing = await OrderPickupQR.findOne({ orderId: order._id, status: 'ACTIVE' }).lean();
    if (existing) { skipped += 1; continue; }
    if (dry) { minted += 1; continue; }
    await OrderPickupService.generateForOrder({ _id: order._id, sellerId: order.sellerId });
    minted += 1;
    console.log(`  ✓ ${order.orderNumber}`);
  }

  console.log(`\n${minted} QR(s) ${dry ? 'would be minted' : 'minted'}, ${skipped} skipped (already had one / no seller).`);
  await disconnectDatabase();
}

main().catch((e) => { console.error(e); process.exit(1); });
