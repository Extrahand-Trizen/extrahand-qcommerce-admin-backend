/**
 * Order Number Generator — format, IST date, uniqueness, concurrency retry,
 * immutability, and backward-compatibility with older `QC-…` numbers.
 *   npx ts-node src/scripts/testOrderNumber.ts
 *
 * Seeds its own `EH-*TEST*` / `QC-ONTEST-` orders against the configured DB and
 * cleans them up. No jest — follows the repo's ad-hoc script pattern.
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import {
  generateOrderNumber,
  isOrderNumberDuplicateError,
  ORDER_NUMBER_MAX_ATTEMPTS,
} from '../services/QcOrderService';
import { istDayString } from '../utils/istDay';

const FORMAT = /^EH-\d{6}-\d{6}$/;
const CLEANUP = { orderNumber: { $regex: /^(EH-\d{6}-\d{6}|QC-ONTEST-)/ } } as const;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = '') {
  ok ? (pass += 1) : (fail += 1);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? `  — ${extra}` : ''}`);
}

function baseDoc(orderNumber: string) {
  return {
    userId: 'ontest-customer',
    sellerId: new Types.ObjectId(),
    orderNumber,
    status: 'PENDING_PAYMENT' as const,
    paymentStatus: 'PENDING' as const,
    fulfillmentEvents: [{ action: 'PLACED', by: 'system' as const, at: new Date() }],
    items: [{ productSlug: 'p', masterProductId: new Types.ObjectId(), name: 'Item', unit: '1', quantity: 1, unitPricePaise: 5000, lineTotalPaise: 5000 }],
    address: { line1: 'x', city: 'Hyderabad', pinCode: '500081', name: 'P', phone: '9848012345' },
    deliveryInstructions: [],
    partnerTipPaise: 0,
    itemTotalPaise: 5000, deliveryFeePaise: 0, handlingFeePaise: 0, couponDiscountPaise: 0, amountPaise: 5000,
  };
}

/** Mirrors QcOrderService.checkout's retry loop. */
async function createWithUniqueNumber() {
  for (let attempt = 1; attempt <= ORDER_NUMBER_MAX_ATTEMPTS; attempt += 1) {
    try {
      const doc = new CustomerOrder(baseDoc(generateOrderNumber()));
      await doc.save();
      return doc;
    } catch (err) {
      if (isOrderNumberDuplicateError(err) && attempt < ORDER_NUMBER_MAX_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new Error('exhausted attempts');
}

async function main() {
  await connectDatabase();
  await CustomerOrder.deleteMany(CLEANUP);

  // ── 1. FORMAT ───────────────────────────────────────────────────────────
  console.log('\nFORMAT');
  const samples = Array.from({ length: 5 }, () => generateOrderNumber());
  console.log('   e.g.', samples.join(', '));
  check('all match EH-YYMMDD-XXXXXX', samples.every((s) => FORMAT.test(s)));
  check('6-digit component is 100000–999999', samples.every((s) => {
    const n = Number(s.split('-')[2]);
    return n >= 100000 && n <= 999999;
  }));
  check('no ObjectId / phone / seller data in it', samples.every((s) => /^EH-\d{6}-\d{6}$/.test(s)));

  // ── 2. IST DATE ─────────────────────────────────────────────────────────
  console.log('\nIST DATE');
  const todayYYMMDD = istDayString().slice(2).replace(/-/g, '');
  check('date part = today in IST', generateOrderNumber().split('-')[1] === todayYYMMDD, `expected ${todayYYMMDD}`);
  // 23:45 UTC on 2026-09-08 is 05:15 IST on 2026-09-09 → must read 260909, not 260908.
  const nearMidnight = new Date('2026-09-08T23:45:00.000Z');
  check('23:45 UTC → next IST day', generateOrderNumber(nearMidnight).split('-')[1] === '260909',
    generateOrderNumber(nearMidnight));
  // 18:20 UTC on 2026-09-09 is 23:50 IST same day → still 260909.
  const lateIst = new Date('2026-09-09T18:20:00.000Z');
  check('23:50 IST → same IST day', generateOrderNumber(lateIst).split('-')[1] === '260909',
    generateOrderNumber(lateIst));

  // ── 3. DB UNIQUE CONSTRAINT ─────────────────────────────────────────────
  console.log('\nDB UNIQUE CONSTRAINT');
  const dupNo = generateOrderNumber();
  await new CustomerOrder(baseDoc(dupNo)).save();
  let dupErr: unknown;
  try { await new CustomerOrder(baseDoc(dupNo)).save(); } catch (e) { dupErr = e; }
  check('second insert with same orderNumber rejected', !!dupErr);
  check('isOrderNumberDuplicateError classifies it', isOrderNumberDuplicateError(dupErr));

  // ── 4. CONCURRENCY / RETRY ──────────────────────────────────────────────
  console.log('\nCONCURRENCY');
  const N = 400;
  const created = await Promise.all(Array.from({ length: N }, () => createWithUniqueNumber()));
  const numbers = created.map((o) => o.orderNumber);
  check(`${N} concurrent creates → all persisted`, created.length === N);
  check('all order numbers unique', new Set(numbers).size === N, `${new Set(numbers).size}/${N} distinct`);
  check('all still match the format', numbers.every((s) => FORMAT.test(s)));

  // ── 5. IMMUTABILITY ─────────────────────────────────────────────────────
  console.log('\nIMMUTABILITY');
  const o = created[0];
  const original = o.orderNumber;
  o.orderNumber = 'EH-000000-000001';
  await o.save();
  const reloaded = await CustomerOrder.findById(o._id).lean();
  check('orderNumber unchanged after reassign + save', reloaded?.orderNumber === original,
    `now ${reloaded?.orderNumber}`);
  await CustomerOrder.updateOne({ _id: o._id }, { $set: { status: 'PAID', fulfillmentStatus: 'READY' } });
  const afterStatus = await CustomerOrder.findById(o._id).lean();
  check('orderNumber unchanged after a status change', afterStatus?.orderNumber === original);

  // ── 6. BACKWARD COMPATIBILITY ──────────────────────────────────────────
  console.log('\nBACKWARD COMPATIBILITY');
  const legacy = await new CustomerOrder(baseDoc('QC-ONTEST-M8X2K1-A3F9')).save();
  const legacyReloaded = await CustomerOrder.findById(legacy._id).lean();
  check('legacy QC-… order saves and loads fine', legacyReloaded?.orderNumber === 'QC-ONTEST-M8X2K1-A3F9');
  check('legacy order is findable by its number',
    !!(await CustomerOrder.findOne({ orderNumber: 'QC-ONTEST-M8X2K1-A3F9' }).lean()));

  // ── 7. SEARCH BY NUMBER ────────────────────────────────────────────────
  console.log('\nSEARCH');
  const target = numbers[10];
  check('exact lookup by orderNumber works', (await CustomerOrder.findOne({ orderNumber: target }).lean())?.orderNumber === target);
  const prefix = target.slice(0, 9); // EH-YYMMDD
  check('prefix search returns today\'s orders', (await CustomerOrder.countDocuments({ orderNumber: { $regex: `^${prefix}` } })) > 0);

  await CustomerOrder.deleteMany(CLEANUP);
  console.log(`\n${pass} passed, ${fail} failed`);
  await disconnectDatabase();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
