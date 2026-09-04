/**
 * Track E — exercise prep-time SLA + "Add time" + the metrics endpoint against
 * local Mongo, without the app.
 *
 *   npx ts-node src/scripts/testPrepSla.ts <sellerId>
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import { OrderFulfillmentService } from '../services/OrderFulfillmentService';
import { getSellerMetrics } from '../services/SellerMetricsService';
import { generateHandoverCode } from '../services/QcOrderService';

/** Check every line so mark-ready is allowed. */
async function checkAllItems(sid: string, orderId: string) {
  const o = await CustomerOrder.findById(orderId).lean();
  for (let i = 0; i < (o?.items.length ?? 0); i += 1) {
    await OrderFulfillmentService.setItemPrepCheck(sid, orderId, i, true);
  }
}

const TAG = /^QC-ETEST-/;

async function seed(sellerId: Types.ObjectId) {
  return CustomerOrder.create({
    userId: 'etest-customer',
    sellerId,
    orderNumber: `QC-ETEST-${Date.now().toString(36).toUpperCase()}`,
    status: 'PAID',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'PENDING_ACCEPT',
    acceptDeadline: new Date(Date.now() + 90_000),
    handoverCode: generateHandoverCode(),
    fulfillmentEvents: [{ action: 'PLACED', by: 'system', at: new Date() }],
    items: [{ productSlug: 'e-milk', masterProductId: new Types.ObjectId(), name: 'Milk', unit: '1 L', quantity: 1, unitPricePaise: 6800, lineTotalPaise: 6800 }],
    address: { line1: 'Test', city: 'Hyderabad', pinCode: '500081', name: 'E Test', phone: '9848012345' },
    deliveryInstructions: [],
    partnerTipPaise: 0,
    itemTotalPaise: 6800,
    deliveryFeePaise: 2900,
    handlingFeePaise: 0,
    couponDiscountPaise: 0,
    amountPaise: 9700,
  });
}

async function main() {
  await connectDatabase();
  const arg = process.argv[2];
  if (!arg || !Types.ObjectId.isValid(arg)) {
    console.error('Usage: ts-node src/scripts/testPrepSla.ts <sellerId>');
    process.exit(1);
  }
  const sellerId = new Types.ObjectId(arg);
  if (!(await Seller.findById(sellerId))) { console.error('No such seller'); process.exit(1); }

  await CustomerOrder.deleteMany({ orderNumber: TAG });
  const sid = String(sellerId);

  // --- Case 1: on-time order -------------------------------------------------
  const a = await seed(sellerId);
  await OrderFulfillmentService.transition(sid, String(a._id), 'accept', { prepMinutes: 15 });
  await OrderFulfillmentService.transition(sid, String(a._id), 'start-preparing');
  await checkAllItems(sid, String(a._id));
  await OrderFulfillmentService.transition(sid, String(a._id), 'mark-ready');
  const a1 = await CustomerOrder.findById(a._id).lean();
  console.log(`\nCase 1 (on time): prepBreached=${a1?.prepBreached}  readyAt<=readyBy=${a1!.readyAt! <= a1!.readyBy!}`);

  // --- Case 2: extend then breach -----------------------------------------
  const b = await seed(sellerId);
  await OrderFulfillmentService.transition(sid, String(b._id), 'accept', { prepMinutes: 10 });
  const beforeExt = await CustomerOrder.findById(b._id).lean();
  await OrderFulfillmentService.transition(sid, String(b._id), 'extend-prep', { addMinutes: 20 });
  const afterExt = await CustomerOrder.findById(b._id).lean();
  console.log(
    `Case 2 extend: readyBy moved +${Math.round((afterExt!.readyBy!.getTime() - beforeExt!.readyBy!.getTime()) / 60000)}min  ` +
    `prepMinutesAdded=${afterExt?.prepMinutesAdded}  events=${afterExt?.fulfillmentEvents.map((e) => e.action).join('→')}`,
  );
  // force the deadline into the past, then mark ready
  await CustomerOrder.updateOne({ _id: b._id }, { $set: { readyBy: new Date(Date.now() - 60_000) } });
  await OrderFulfillmentService.transition(sid, String(b._id), 'start-preparing');
  await checkAllItems(sid, String(b._id));
  await OrderFulfillmentService.transition(sid, String(b._id), 'mark-ready');
  const b1 = await CustomerOrder.findById(b._id).lean();
  console.log(`Case 2 (late):  prepBreached=${b1?.prepBreached} (expect true)`);

  // --- Case 3: illegal extend ----------------------------------------------
  try {
    await OrderFulfillmentService.transition(sid, String(b._id), 'extend-prep', { addMinutes: 5 });
    console.log('Case 3: FAIL — extend on a READY order was allowed');
  } catch (e) {
    console.log(`Case 3 (illegal extend): rejected ✓  "${(e as Error).message}"`);
  }

  // --- Metrics -------------------------------------------------------------
  const m = await getSellerMetrics(sid, '7d');
  console.log('\n--- metrics (7d) ---');
  console.log(m);

  await CustomerOrder.deleteMany({ orderNumber: TAG });
  console.log('\ncleaned up.');
  await disconnectDatabase();
}

main().catch((err) => { console.error(err); process.exit(1); });
