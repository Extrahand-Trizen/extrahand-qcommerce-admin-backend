/**
 * Partner order completion — scenario runner against a real DB.
 *   npx ts-node src/scripts/testPartnerCompletion.ts <sellerId>
 *
 * Seeds its own QC-DONETEST- orders directly in HANDED_OVER and cleans them up.
 * Socket emits are no-ops here (no io server); the notification call is
 * best-effort and will just log a warning. No jest — repo's ad-hoc script style.
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import { PartnerCompletionService } from '../services/PartnerCompletionService';

const TAG = /^QC-DONETEST-/;
const partner = { uid: 'donetest-partner-1', name: 'Done Test Partner', phone: '9848000001' };
const partner2 = { uid: 'donetest-partner-2', name: 'Other Partner' };

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = '') {
  ok ? (pass += 1) : (fail += 1);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? `  — ${extra}` : ''}`);
}
async function expectFail(label: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, `expected ${code}, got success`);
  } catch (e) {
    const actual = (e as { code?: string }).code;
    check(label, actual === code, actual ? `got ${actual}` : `got ${(e as Error).message}`);
  }
}

async function seedHandedOver(sellerId: Types.ObjectId, partnerUid: string | null) {
  return CustomerOrder.create({
    userId: 'donetest-customer',
    sellerId,
    orderNumber: `QC-DONETEST-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4)}`,
    shopName: 'Done Test Store',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'HANDED_OVER',
    partnerUid,
    partnerName: partnerUid ? partner.name : null,
    partnerAcceptedAt: new Date(),
    fulfillmentEvents: [
      { action: 'PLACED', by: 'system', at: new Date() },
      { action: 'PICKED_UP', by: 'system', at: new Date(), meta: { partnerUid } },
    ],
    items: [
      { productSlug: 'p', masterProductId: new Types.ObjectId(), name: 'Item', unit: '1', quantity: 1, unitPricePaise: 5000, lineTotalPaise: 5000 },
    ],
    address: { line1: 'x', city: 'Hyderabad', pinCode: '500081', name: 'P', phone: '9848012345' },
    deliveryInstructions: [],
    partnerTipPaise: 0,
    itemTotalPaise: 5000, deliveryFeePaise: 0, handlingFeePaise: 0, couponDiscountPaise: 0, amountPaise: 5000,
  });
}

async function main() {
  const sellerId = process.argv[2];
  if (!sellerId || !Types.ObjectId.isValid(sellerId)) {
    console.error('Usage: testPartnerCompletion.ts <sellerId>');
    process.exit(1);
  }
  await connectDatabase();
  const sid = new Types.ObjectId(sellerId);

  try {
    // 1 — happy path
    const o1 = await seedHandedOver(sid, partner.uid);
    const res = await PartnerCompletionService.completeOrder(partner, String(o1._id));
    const fresh1 = await CustomerOrder.findById(o1._id).lean();
    check('completeOrder returns success', res.alreadyCompleted === false);
    check('fulfillmentStatus → COMPLETED', fresh1?.fulfillmentStatus === 'COMPLETED', String(fresh1?.fulfillmentStatus));
    check('parent status → DELIVERED', fresh1?.status === 'DELIVERED', String(fresh1?.status));
    check('completedAt stamped', !!fresh1?.completedAt);
    check('COMPLETED fulfilment event pushed', !!fresh1?.fulfillmentEvents?.some((e) => e.action === 'COMPLETED'));

    // 2 — second complete is idempotent
    const res2 = await PartnerCompletionService.completeOrder(partner, String(o1._id));
    check('re-complete is a no-op (alreadyCompleted)', res2.alreadyCompleted === true);

    // 3 — wrong partner
    const o2 = await seedHandedOver(sid, partner.uid);
    await expectFail('another partner → 403 NOT_ASSIGNED', 'NOT_ASSIGNED', () =>
      PartnerCompletionService.completeOrder(partner2, String(o2._id)),
    );

    // 4 — order not handed over yet
    const o3 = await seedHandedOver(sid, partner.uid);
    await CustomerOrder.updateOne({ _id: o3._id }, { $set: { fulfillmentStatus: 'READY', partnerUid: partner.uid } });
    await expectFail('order still READY → 409 INVALID_STATUS', 'INVALID_STATUS', () =>
      PartnerCompletionService.completeOrder(partner, String(o3._id)),
    );

    // 5 — no partner on the order at all
    const o4 = await seedHandedOver(sid, null);
    await expectFail('order with no partnerUid → 403 NOT_ASSIGNED', 'NOT_ASSIGNED', () =>
      PartnerCompletionService.completeOrder(partner, String(o4._id)),
    );

    // 6 — unknown order
    await expectFail('unknown orderId → 404 ORDER_NOT_FOUND', 'ORDER_NOT_FOUND', () =>
      PartnerCompletionService.completeOrder(partner, String(new Types.ObjectId())),
    );
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
