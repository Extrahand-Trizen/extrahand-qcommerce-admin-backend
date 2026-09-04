/**
 * Track B — verify the per-day rejection cycle + 3-minute auto-pause + auto-reopen.
 *   npx ts-node src/scripts/testShopPause.ts <sellerId>
 *
 * Walks: cycle 1 (pause at 3) → force-expire the pause → reopen (cycle → 0,
 * daily kept) → cycle 2 (pause again) → simulate an IST-midnight rollover.
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import SellerStoreSettings from '../models/SellerStoreSettings';
import { OrderFulfillmentService } from '../services/OrderFulfillmentService';
import { reopenExpiredPauses, rolloverRejectionDayIfNeeded } from '../services/SellerFulfillmentHealthService';
import { SellerStoreSettingsService } from '../services/SellerStoreSettingsService';
import { generateHandoverCode } from '../services/QcOrderService';
import { REJECTION_CYCLE_THRESHOLD, PAUSE_DURATION_MINUTES } from '../config/orderFulfillment';

const TAG = /^QC-PAUSETEST-/;

async function seedNew(sellerId: Types.ObjectId) {
  return CustomerOrder.create({
    userId: 'pause-customer', sellerId,
    orderNumber: `QC-PAUSETEST-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4)}`,
    status: 'PAID', paymentStatus: 'PAID', fulfillmentStatus: 'PENDING_ACCEPT',
    acceptDeadline: new Date(Date.now() + 90_000), handoverCode: generateHandoverCode(),
    fulfillmentEvents: [{ action: 'PLACED', by: 'system', at: new Date() }],
    items: [{ productSlug: 'p', masterProductId: new Types.ObjectId(), name: 'Item', unit: '1', quantity: 1, unitPricePaise: 5000, lineTotalPaise: 5000 }],
    address: { line1: 'x', city: 'Hyderabad', pinCode: '500081', name: 'P', phone: '9848012345' },
    deliveryInstructions: [], partnerTipPaise: 0,
    itemTotalPaise: 5000, deliveryFeePaise: 0, handlingFeePaise: 0, couponDiscountPaise: 0, amountPaise: 5000,
  });
}

async function reject(sellerId: string) {
  const o = await seedNew(new Types.ObjectId(sellerId));
  await OrderFulfillmentService.transition(sellerId, String(o._id), 'reject', { reason: 'TOO_BUSY' });
  await new Promise((r) => setTimeout(r, 300)); // recordRejectionOrMiss is fire-and-forget
}

async function status(sellerId: string) {
  const s = await SellerStoreSettings.findOne({ sellerId }).lean();
  return `storeStatus=${s?.storeStatus} autoPaused=${Boolean(s?.autoPausedAt)} pauseUntil=${s?.pauseUntil?.toISOString() ?? '-'} cycle=${s?.rejectionCycleCount ?? 0} daily=${s?.dailyRejectedCount ?? 0} day=${s?.rejectionDay ?? '-'}`;
}

async function resetShop(sellerId: Types.ObjectId) {
  await CustomerOrder.deleteMany({ orderNumber: TAG });
  await SellerStoreSettings.updateOne(
    { sellerId },
    {
      $set: { storeStatus: 'OPEN', statusMode: 'MANUAL', dailyRejectedCount: 0, rejectionCycleCount: 0 },
      $unset: { autoPausedAt: 1, pauseUntil: 1, pauseReason: 1, rejectionCycleStartedAt: 1, rejectionDay: 1 },
    },
    { upsert: true },
  );
}

async function main() {
  await connectDatabase();
  const arg = process.argv[2];
  if (!arg || !Types.ObjectId.isValid(arg)) { console.error('Usage: testShopPause.ts <sellerId>'); process.exit(1); }
  const sellerId = new Types.ObjectId(arg);
  const sid = String(sellerId);

  console.log(`config: pause after ${REJECTION_CYCLE_THRESHOLD} rejects/misses per cycle, pause lasts ${PAUSE_DURATION_MINUTES} min\n`);
  await resetShop(sellerId);

  // --- CYCLE 1 --------------------------------------------------------------
  await reject(sid);
  console.log('cycle1 reject 1 :', await status(sid), '  (expect OPEN cycle=1)');
  await reject(sid);
  console.log('cycle1 reject 2 :', await status(sid), '  (expect OPEN cycle=2)');
  await reject(sid);
  console.log('cycle1 reject 3 :', await status(sid), `  (expect CLOSED autoPaused pauseUntil ~${PAUSE_DURATION_MINUTES}min cycle=3 daily=3)`);

  const dto = await SellerStoreSettingsService.getForSeller(sid);
  console.log('\nDTO -> autoPaused:', dto.autoPaused, ' pauseUntil:', dto.pauseUntil, ' cycle:', dto.rejectionCycleCount, ' daily:', dto.dailyRejectedCount);

  // --- PAUSE EXPIRY --------------------------------------------------------
  await SellerStoreSettings.updateOne({ sellerId }, { $set: { pauseUntil: new Date(Date.now() - 60_000) } });
  const reopened = await reopenExpiredPauses({ sellerId });
  console.log('\nreopenExpiredPauses ->', reopened, 'shop(s) |', await status(sid), '  (expect OPEN cycle=0 daily=3)');

  // --- CYCLE 2 (previous 3 must NOT carry over) ---------------------------
  await reject(sid);
  await reject(sid);
  console.log('\ncycle2 reject 2 :', await status(sid), '  (expect OPEN cycle=2 daily=5)');
  await reject(sid);
  console.log('cycle2 reject 3 :', await status(sid), '  (expect CLOSED autoPaused cycle=3 daily=6)');

  // --- MIDNIGHT ROLLOVER -------------------------------------------------
  await SellerStoreSettings.updateOne({ sellerId }, { $set: { pauseUntil: new Date(Date.now() - 60_000) } });
  await reopenExpiredPauses({ sellerId });
  await SellerStoreSettings.updateOne({ sellerId }, { $set: { rejectionDay: '2000-01-01' } });
  await rolloverRejectionDayIfNeeded(sid);
  console.log('\nafter simulated midnight:', await status(sid), '  (expect cycle=0 daily=0 day=today)');
  await reject(sid);
  console.log('day2 reject 1   :', await status(sid), '  (expect OPEN cycle=1 daily=1  — NOT 3)');

  await resetShop(sellerId);
  console.log('\ncleaned up + shop reset to OPEN.');
  await disconnectDatabase();
}

main().catch((e) => { console.error(e); process.exit(1); });
