/**
 * Track B — exercise the accept-timeout engine end to end against local Mongo,
 * without a real payment.
 *
 *   npx ts-node src/scripts/testAcceptTimeout.ts <sellerId> [count]
 *
 * Creates <count> (default 3) PAID orders already past their acceptDeadline,
 * runs the sweep once, then prints each order's outcome and the shop's health
 * (miss log + whether it auto-closed). Cleans up its own orders afterwards
 * unless you pass --keep.
 *
 * Get <sellerId> from:  npx ts-node src/scripts/checkOrderRouting.ts
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import SellerStoreSettings from '../models/SellerStoreSettings';
import { generateHandoverCode } from '../services/QcOrderService';
import { OrderTimeoutService } from '../services/OrderTimeoutService';
import { REJECTION_CYCLE_THRESHOLD } from '../config/orderFulfillment';

const TAG = /^QC-BTEST-/;

async function main() {
  await connectDatabase();
  const keep = process.argv.includes('--keep');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const sellerArg = args[0];
  const count = Math.max(1, Number(args[1]) || 3);

  if (!sellerArg || !Types.ObjectId.isValid(sellerArg)) {
    console.error('Usage: ts-node src/scripts/testAcceptTimeout.ts <sellerId> [count]');
    process.exit(1);
  }
  const sellerId = new Types.ObjectId(sellerArg);
  const seller = await Seller.findById(sellerId).select('_id fullName').lean();
  if (!seller) {
    console.error('No seller with that id.');
    process.exit(1);
  }

  // Start from a clean, open shop so the auto-close assertion is meaningful.
  await CustomerOrder.deleteMany({ orderNumber: TAG });
  await SellerStoreSettings.findOneAndUpdate(
    { sellerId },
    { $set: { storeStatus: 'OPEN', statusMode: 'MANUAL', dailyRejectedCount: 0, rejectionCycleCount: 0 }, $unset: { autoPausedAt: 1, pauseUntil: 1, pauseReason: 1, rejectionCycleStartedAt: 1 } },
    { upsert: true, setDefaultsOnInsert: true },
  );

  console.log(`\nSeller: ${seller.fullName} (${sellerId})`);
  console.log(`Config: auto-pause after ${REJECTION_CYCLE_THRESHOLD} rejections/misses in a cycle\n`);

  const ids: Types.ObjectId[] = [];
  for (let i = 0; i < count; i += 1) {
    const order = await CustomerOrder.create({
      userId: `btest-customer-${i}`,
      sellerId,
      shopName: seller.fullName || 'Test shop',
      orderNumber: `QC-BTEST-${Date.now().toString(36).toUpperCase()}-${i}`,
      status: 'PAID',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'PENDING_ACCEPT',
      // Already lapsed.
      acceptDeadline: new Date(Date.now() - 60_000),
      handoverCode: generateHandoverCode(),
      fulfillmentEvents: [{ action: 'PLACED', by: 'system', at: new Date() }],
      items: [
        { productSlug: 'btest-milk', masterProductId: new Types.ObjectId(), name: 'Milk', unit: '1 L', quantity: 1, unitPricePaise: 6800, lineTotalPaise: 6800 },
      ],
      address: { line1: 'Test', city: 'Hyderabad', pinCode: '500081', name: 'B Test', phone: '9848012345' },
      deliveryInstructions: [],
      partnerTipPaise: 0,
      itemTotalPaise: 6800,
      deliveryFeePaise: 2900,
      handlingFeePaise: 0,
      couponDiscountPaise: 0,
      amountPaise: 9700,
    });
    ids.push(order._id as Types.ObjectId);
  }
  console.log(`Created ${ids.length} past-deadline PENDING_ACCEPT order(s).`);

  const swept = await OrderTimeoutService.expireStale({ sellerId });
  console.log(`Sweep auto-rejected ${swept} order(s).`);
  // Give the fire-and-forget refund settle a beat.
  await new Promise((r) => setTimeout(r, 500));

  console.log('\n--- order outcomes ---');
  for (const id of ids) {
    const o = await CustomerOrder.findById(id).lean();
    if (!o) continue;
    const evt = o.fulfillmentEvents.map((e) => e.action).join(' → ');
    const refund = o.refunds[0];
    console.log(
      `${o.orderNumber}\n  fulfillmentStatus=${o.fulfillmentStatus} rejectedReason=${o.rejectedReason}\n` +
      `  events: ${evt}\n` +
      `  refund: ${refund ? `${refund.amountPaise}p ${refund.status}${refund.note ? ` (${refund.note})` : ''}` : 'NONE'}`,
    );
  }

  const health = await SellerStoreSettings.findOne({ sellerId }).lean();
  console.log('\n--- shop health ---');
  console.log(`  storeStatus: ${health?.storeStatus}`);
  console.log(`  rejectionCycleCount: ${health?.rejectionCycleCount ?? 0}  ·  dailyRejectedCount: ${health?.dailyRejectedCount ?? 0}`);
  console.log(`  autoPausedAt: ${health?.autoPausedAt?.toISOString() ?? 'not paused'}`);
  const expectPause = count >= REJECTION_CYCLE_THRESHOLD;
  const didPause = Boolean(health?.autoPausedAt);
  console.log(`\n  expected auto-pause: ${expectPause} · actual: ${didPause} · ${expectPause === didPause ? 'OK ✓' : 'MISMATCH ✗'}`);

  if (!keep) {
    await CustomerOrder.deleteMany({ orderNumber: TAG });
    await SellerStoreSettings.findOneAndUpdate(
      { sellerId },
      { $set: { storeStatus: 'OPEN', statusMode: 'MANUAL', dailyRejectedCount: 0, rejectionCycleCount: 0 }, $unset: { autoPausedAt: 1, pauseUntil: 1, pauseReason: 1, rejectionCycleStartedAt: 1 } },
    );
    console.log('\nCleaned up test orders + reset shop to OPEN. (pass --keep to inspect)');
  }

  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
