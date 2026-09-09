/**
 * Order Pickup QR — end-to-end scenario runner against a real DB.
 *   npx ts-node src/scripts/testPickupQr.ts <sellerId>
 *
 * Requires PICKUP_QR_SECRET in the environment. Seeds its own QC-QRTEST- orders
 * and cleans them up at the end. No jest — follows the repo's ad-hoc script pattern.
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import OrderPickupQR from '../models/OrderPickupQR';
import { OrderFulfillmentService } from '../services/OrderFulfillmentService';
import { OrderPickupService, QR_PREFIX } from '../services/OrderPickupService';
import { env } from '../config/env';

const TAG = /^QC-QRTEST-/;
const partner = { uid: 'qrtest-partner-1', name: 'QR Test Partner' };
const partner2 = { uid: 'qrtest-partner-2', name: 'Other Partner' };

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = '') {
  (ok ? (pass += 1) : (fail += 1));
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

async function seedReadyOrder(sellerId: Types.ObjectId) {
  const order = await CustomerOrder.create({
    userId: 'qrtest-customer',
    sellerId,
    orderNumber: `QC-QRTEST-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4)}`,
    shopName: 'QR Test Store',
    status: 'PAID',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'PREPARING',
    preparingStartedAt: new Date(),
    fulfillmentEvents: [{ action: 'PLACED', by: 'system', at: new Date() }],
    items: [{ productSlug: 'p', masterProductId: new Types.ObjectId(), name: 'Item', unit: '1', quantity: 1, unitPricePaise: 5000, lineTotalPaise: 5000, preparationChecked: true }],
    address: { line1: 'x', city: 'Hyderabad', pinCode: '500081', name: 'P', phone: '9848012345' },
    deliveryInstructions: [],
    partnerTipPaise: 0,
    itemTotalPaise: 5000, deliveryFeePaise: 0, handlingFeePaise: 0, couponDiscountPaise: 0, amountPaise: 5000,
  });
  await OrderFulfillmentService.transition(String(sellerId), String(order._id), 'mark-ready');
  return CustomerOrder.findById(order._id);
}

async function activeQrString(orderId: string) {
  const qr = await OrderPickupQR.findOne({ orderId, status: 'ACTIVE' }).lean();
  return qr ? `${QR_PREFIX}${qr.token}` : null;
}

async function cleanup(sellerId: Types.ObjectId) {
  const orders = await CustomerOrder.find({ orderNumber: TAG }).select('_id').lean();
  await OrderPickupQR.deleteMany({ orderId: { $in: orders.map((o) => o._id) } });
  await OrderPickupQR.deleteMany({ sellerId });
  await CustomerOrder.deleteMany({ orderNumber: TAG });
}

async function main() {
  if (!env.PICKUP_QR_SECRET) {
    console.error('PICKUP_QR_SECRET is not set — cannot run.');
    process.exit(1);
  }
  await connectDatabase();
  const arg = process.argv[2];
  if (!arg || !Types.ObjectId.isValid(arg)) {
    console.error('Usage: testPickupQr.ts <sellerId>');
    process.exit(1);
  }
  const sellerId = new Types.ObjectId(arg);
  const sid = String(sellerId);
  await cleanup(sellerId);

  // ── POSITIVE ────────────────────────────────────────────────────────────
  console.log('\nPOSITIVE');
  const o1 = await seedReadyOrder(sellerId);
  const qr1 = await activeQrString(String(o1!._id));
  check('mark-ready minted an ACTIVE QR', !!qr1);
  check('GET pickup-qr returns it', !!(await OrderPickupService.getForOrder(String(o1!._id), sid)));

  const res = await OrderPickupService.verifyAndCompletePickup(partner, qr1!);
  check('valid scan → success', res.success && res.status === 'HANDED_OVER');
  const o1b = await CustomerOrder.findById(o1!._id).lean();
  check('order is HANDED_OVER', o1b?.fulfillmentStatus === 'HANDED_OVER');
  check('order.partnerUid set to scanner', o1b?.partnerUid === partner.uid);
  check('order.status PAID → CONFIRMED', o1b?.status === 'CONFIRMED');
  const qr1row = await OrderPickupQR.findOne({ orderId: o1!._id }).lean();
  check('QR row is USED', qr1row?.status === 'USED');

  // ── NEGATIVE ────────────────────────────────────────────────────────────
  console.log('\nNEGATIVE');
  await expectFail('re-scan of a USED QR → QR_ALREADY_USED', 'QR_ALREADY_USED', () =>
    OrderPickupService.verifyAndCompletePickup(partner, qr1!));

  await expectFail('tampered token → INVALID_QR', 'INVALID_QR', () =>
    OrderPickupService.verifyAndCompletePickup(partner, `${qr1!}x`));

  await expectFail('garbage string → INVALID_QR', 'INVALID_QR', () =>
    OrderPickupService.verifyAndCompletePickup(partner, 'ORDER_PICKUP:not-a-jwt'));

  const o2 = await seedReadyOrder(sellerId);
  const qr2 = await activeQrString(String(o2!._id));
  // order from another store
  const otherSeller = new Types.ObjectId();
  await CustomerOrder.updateOne({ _id: o2!._id }, { $set: { sellerId: otherSeller } });
  await expectFail('QR store ≠ order store → STORE_MISMATCH', 'STORE_MISMATCH', () =>
    OrderPickupService.verifyAndCompletePickup(partner, qr2!));
  await CustomerOrder.updateOne({ _id: o2!._id }, { $set: { sellerId } });

  // reprepare → old jti dead, new one works
  const o3 = await seedReadyOrder(sellerId);
  const qr3old = await activeQrString(String(o3!._id));
  await OrderFulfillmentService.transition(sid, String(o3!._id), 'back-to-preparing');
  await expectFail('after back-to-preparing old QR → QR_REVOKED', 'QR_REVOKED', () =>
    OrderPickupService.verifyAndCompletePickup(partner, qr3old!));
  for (let i = 0; i < 1; i += 1) await OrderFulfillmentService.setItemPrepCheck(sid, String(o3!._id), i, true);
  await OrderFulfillmentService.transition(sid, String(o3!._id), 'mark-ready');
  const qr3new = await activeQrString(String(o3!._id));
  check('new QR after re-mark-ready differs', qr3new !== qr3old);
  const r3 = await OrderPickupService.verifyAndCompletePickup(partner, qr3new!);
  check('new QR scans OK', r3.success);

  // cancelled order → QR revoked
  const o4 = await seedReadyOrder(sellerId);
  const qr4 = await activeQrString(String(o4!._id));
  await CustomerOrder.updateOne({ _id: o4!._id }, { $set: { status: 'CANCELLED' } });
  await OrderPickupService.revokeForOrder(o4!._id, 'ORDER_CANCELLED');
  await expectFail('cancelled order QR → QR_REVOKED', 'QR_REVOKED', () =>
    OrderPickupService.verifyAndCompletePickup(partner, qr4!));

  // not-ready order (fresh PREPARING, manually minted QR)
  const o5 = await seedReadyOrder(sellerId);
  const qr5 = await activeQrString(String(o5!._id));
  await CustomerOrder.updateOne({ _id: o5!._id }, { $set: { fulfillmentStatus: 'PREPARING' } });
  await expectFail('order not READY → ORDER_NOT_READY', 'ORDER_NOT_READY', () =>
    OrderPickupService.verifyAndCompletePickup(partner, qr5!));

  // ── CONCURRENCY ─────────────────────────────────────────────────────────
  console.log('\nCONCURRENCY');
  const o6 = await seedReadyOrder(sellerId);
  const qr6 = await activeQrString(String(o6!._id));
  const settled = await Promise.allSettled([
    OrderPickupService.verifyAndCompletePickup(partner, qr6!),
    OrderPickupService.verifyAndCompletePickup(partner2, qr6!),
  ]);
  const okCount = settled.filter((s) => s.status === 'fulfilled').length;
  check('two concurrent scans → exactly one success', okCount === 1, `${okCount} succeeded`);

  await cleanup(sellerId);
  console.log(`\n${pass} passed, ${fail} failed`);
  await disconnectDatabase();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
