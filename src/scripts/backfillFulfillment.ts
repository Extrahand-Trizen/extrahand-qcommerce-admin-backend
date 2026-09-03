/**
 * One-time backfill: give every already-PAID order a fulfilment status so it
 * shows up in the seller app's new order queue.
 *
 *   ts-node src/scripts/backfillFulfillment.ts
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import { generateHandoverCode } from '../services/QcOrderService';

async function backfillFulfillment(): Promise<void> {
  await connectDatabase();

  const orders = await CustomerOrder.find({
    paymentStatus: 'PAID',
    $or: [{ fulfillmentStatus: { $exists: false } }, { fulfillmentStatus: null }],
  });

  console.log(`Found ${orders.length} paid order(s) without a fulfilment status.`);

  let updated = 0;
  let skipped = 0;
  for (const order of orders) {
    if (!order.sellerId) {
      // No store attached → no shopkeeper can ever see it. Leave it alone;
      // it needs the routing bug fixed / a manual sellerId, not a status.
      console.warn(`  – ${order.orderNumber}: no sellerId, skipping (see docs/order-routing-check.md)`);
      skipped += 1;
      continue;
    }
    order.fulfillmentStatus = 'PENDING_ACCEPT';
    if (!order.handoverCode) order.handoverCode = generateHandoverCode();
    order.fulfillmentEvents.push({
      action: 'PLACED',
      by: 'system',
      at: order.createdAt ?? new Date(),
      meta: { backfilled: true },
    });
    await order.save();
    console.log(`  ✓ ${order.orderNumber} → PENDING_ACCEPT (code ${order.handoverCode})`);
    updated += 1;
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped (no sellerId).`);
  await mongoose.disconnect();
}

backfillFulfillment().catch((err) => {
  console.error(err);
  process.exit(1);
});
