/**
 * DB change-stream completion watcher — scenario runner against a real DB.
 *   npx ts-node src/scripts/testCompletionWatcher.ts <sellerId>
 *
 * Seeds a QC-WATCHTEST- order in HANDED_OVER, starts the watcher, then flips
 * fulfillmentStatus straight in the DB (simulating a Compass / mongosh edit) and
 * checks the watcher announces it exactly once. Cleans up. Requires a replica
 * set (Atlas). No jest.
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import { notifyOrderCompletedOnce } from '../services/OrderCompletionNotifier';
import {
  startOrderCompletionWatcher,
  stopOrderCompletionWatcher,
} from '../watchers/orderCompletionWatcher';

const TAG = /^QC-WATCHTEST-/;
let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, extra = '') => {
  ok ? (pass += 1) : (fail += 1);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? `  — ${extra}` : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seed(sellerId: Types.ObjectId) {
  return CustomerOrder.create({
    userId: 'watchtest-customer',
    sellerId,
    orderNumber: `QC-WATCHTEST-${Date.now().toString(36).toUpperCase()}`,
    shopName: 'Watch Test Store',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'HANDED_OVER',
    partnerUid: 'watchtest-partner',
    partnerName: 'Watch Partner',
    partnerAcceptedAt: new Date(),
    fulfillmentEvents: [{ action: 'PICKED_UP', by: 'system', at: new Date() }],
    items: [{ productSlug: 'p', masterProductId: new Types.ObjectId(), name: 'Item', unit: '1', quantity: 1, unitPricePaise: 5000, lineTotalPaise: 5000 }],
    address: { line1: 'x', city: 'Hyderabad', pinCode: '500081', name: 'P', phone: '9848012345' },
    deliveryInstructions: [],
    partnerTipPaise: 0,
    itemTotalPaise: 5000, deliveryFeePaise: 0, handlingFeePaise: 0, couponDiscountPaise: 0, amountPaise: 5000,
  });
}

async function main() {
  const sellerId = process.argv[2];
  if (!sellerId || !Types.ObjectId.isValid(sellerId)) {
    console.error('Usage: testCompletionWatcher.ts <sellerId>');
    process.exit(1);
  }
  await connectDatabase();
  const sid = new Types.ObjectId(sellerId);

  try {
    // notifyOrderCompletedOnce dedup — no watcher involved
    const a = await seed(sid);
    await CustomerOrder.updateOne({ _id: a._id }, { $set: { fulfillmentStatus: 'COMPLETED' } });
    const first = await notifyOrderCompletedOnce(a._id);
    const second = await notifyOrderCompletedOnce(a._id);
    check('notifyOrderCompletedOnce: first call announces', first === true);
    check('notifyOrderCompletedOnce: second call is a no-op', second === false);
    const aDoc = await CustomerOrder.findById(a._id).select('completionNotifiedAt').lean();
    check('completionNotifiedAt stamped', !!aDoc?.completionNotifiedAt);

    // not COMPLETED yet → no-op
    const b = await seed(sid);
    check('HANDED_OVER order → notify no-op', (await notifyOrderCompletedOnce(b._id)) === false);

    // the watcher: start it, then edit the DB directly
    startOrderCompletionWatcher();
    await sleep(2500); // let the stream open

    const c = await seed(sid);
    await CustomerOrder.updateOne(
      { _id: c._id },
      { $set: { fulfillmentStatus: 'COMPLETED', status: 'DELIVERED', completedAt: new Date() } },
    );

    let seen = false;
    for (let i = 0; i < 20 && !seen; i += 1) {
      await sleep(500);
      const doc = await CustomerOrder.findById(c._id).select('completionNotifiedAt').lean();
      seen = !!doc?.completionNotifiedAt;
    }
    check('watcher announced a direct DB edit within ~10s', seen);

    await stopOrderCompletionWatcher();
  } finally {
    const del = await CustomerOrder.deleteMany({ orderNumber: TAG });
    console.log(`\ncleaned up ${del.deletedCount} test orders`);
    await disconnectDatabase();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
