/**
 * Track B — while a shop is auto-paused the seller cannot toggle the store
 * open/closed or change the mode; the pause timer is preserved. Once the pause
 * timer passes, the lock lifts and the shop reopens on its own.
 * Run: npx ts-node src/scripts/testPausedStoreToggleLock.ts
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import SellerStoreSettings from '../models/SellerStoreSettings';
import { SellerStoreSettingsService } from '../services/SellerStoreSettingsService';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`❌ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run() {
  await connectDatabase();
  const sellerId = new mongoose.Types.ObjectId();
  const sid = String(sellerId);

  // Auto-paused: closed, manual, pause ends in 3 min.
  const pauseUntil = new Date(Date.now() + 3 * 60 * 1000);
  await SellerStoreSettings.create({
    sellerId, storeStatus: 'CLOSED', statusMode: 'MANUAL',
    autoPausedAt: new Date(), pauseUntil, pauseReason: 'Multiple orders were rejected or missed',
    rejectionCycleCount: 3,
  });

  console.log('\n=== While paused: seller tries to re-open ===');
  let blocked = false;
  try {
    await SellerStoreSettingsService.update(sid, { storeStatus: 'open' });
  } catch (e: any) {
    blocked = true;
    assert(e.statusCode === 409, `rejected with 409 (got ${e.statusCode})`);
    assert(/paused/i.test(e.message), `message mentions the pause: "${e.message}"`);
  }
  assert(blocked, 'open toggle was blocked');

  console.log('\n=== While paused: seller tries to switch to Automatic ===');
  blocked = false;
  try {
    await SellerStoreSettingsService.update(sid, { statusMode: 'scheduled' });
  } catch {
    blocked = true;
  }
  assert(blocked, 'mode switch was blocked');

  let s = await SellerStoreSettings.findOne({ sellerId }).lean();
  assert(!!s?.autoPausedAt, 'pause is still active (autoPausedAt intact)');
  assert(s?.pauseUntil?.getTime() === pauseUntil.getTime(), 'pauseUntil timer unchanged');
  assert(s?.storeStatus === 'CLOSED', 'store still CLOSED');

  console.log('\n=== While paused: editing hours is still allowed ===');
  const dto = await SellerStoreSettingsService.update(sid, { openTime: '08:00', closeTime: '22:00' });
  assert(dto.openTime === '08:00' && dto.closeTime === '22:00', 'hours updated during pause');
  assert(dto.autoPaused === true, 'still reported as paused after the hours edit');

  console.log('\n=== Pause timer passes → lock lifts, shop reopens ===');
  await SellerStoreSettings.updateOne({ sellerId }, { $set: { pauseUntil: new Date(Date.now() - 1000) } });
  const afterExpiry = await SellerStoreSettingsService.update(sid, { storeStatus: 'closed' });
  assert(afterExpiry.autoPaused === false, 'expired pause cleared on next update');
  s = await SellerStoreSettings.findOne({ sellerId }).lean();
  assert(!s?.autoPausedAt && !s?.pauseUntil, 'pause fields unset');
  assert((s?.rejectionCycleCount ?? -1) === 0, 'rejection cycle reset to 0 on reopen');

  await SellerStoreSettings.deleteMany({ sellerId });
  console.log('\n🎉 PAUSED-STORE TOGGLE LOCK: ALL CHECKS PASSED\n');
  await disconnectDatabase();
  process.exit(0);
}

run().catch(async (e) => { console.error('\n', e); await disconnectDatabase().catch(() => {}); process.exit(1); });
