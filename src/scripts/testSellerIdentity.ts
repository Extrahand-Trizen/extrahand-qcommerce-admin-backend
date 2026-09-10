/**
 * Seller identity resilience — Firebase UID rotation recovery by verified phone.
 *   npx ts-node src/scripts/testSellerIdentity.ts
 *
 * Seeds its own `idtest-*` sellers against the configured DB and cleans them up.
 * Exercises SellerIdentityService.resolveSellerByUidOrPhone + registerSeller. No jest.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import { resolveSellerByUidOrPhone } from '../services/SellerIdentityService';
import { SellerService } from '../services/SellerService';

const TAG = /^idtest-/;
let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, extra = '') => {
  ok ? (pass += 1) : (fail += 1);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? `  — ${extra}` : ''}`);
};

async function seed(userId: string, phone: string, status = 'ACTIVE') {
  return Seller.create({
    userId,
    fullName: 'ID Test',
    mobileNumber: phone,
    status,
    onboardingStatus: 'APPROVED',
  });
}

async function cleanup() {
  await Seller.deleteMany({ userId: TAG });
}

async function main() {
  await connectDatabase();
  await cleanup();

  // ── 1. Normal login — UID matches ───────────────────────────────────────
  console.log('\n1. NORMAL LOGIN');
  const s1 = await seed('idtest-uid-1', '5550000001');
  const r1 = await resolveSellerByUidOrPhone({ userId: 'idtest-uid-1' });
  check('resolves by UID', r1.ok && String(r1.ok && r1.seller._id) === String(s1._id));
  check('not healed', r1.ok && r1.healed === false);
  const s1reload = await Seller.findById(s1._id).lean();
  check('userId unchanged', s1reload?.userId === 'idtest-uid-1');

  // ── 2. Firebase UID changed — recover by phone ─────────────────────────
  console.log('\n2. UID CHANGED (REST path)');
  const r2 = await resolveSellerByUidOrPhone({ userId: 'idtest-uid-1-NEW', verifiedPhone: '+91 5550000001' });
  check('UID miss → phone recovers same seller', r2.ok && String(r2.ok && r2.seller._id) === String(s1._id));
  check('marked healed', r2.ok && r2.healed === true);
  const s1after = await Seller.findById(s1._id).lean();
  check('Seller._id unchanged, userId rebound to NEW', s1after?.userId === 'idtest-uid-1-NEW');
  const count1 = await Seller.countDocuments({ mobileNumber: '5550000001', userId: TAG });
  check('NO duplicate seller created', count1 === 1);

  // ── 3. Same recovery is what the socket uses ───────────────────────────
  console.log('\n3. UID CHANGED (socket uses the same resolver)');
  const r3 = await resolveSellerByUidOrPhone({ userId: 'idtest-uid-1-NEW2', verifiedPhone: '5550000001' });
  check('socket path resolves existing seller', r3.ok && String(r3.ok && r3.seller._id) === String(s1._id));
  check('socket.data.sellerId would be the permanent _id', r3.ok && typeof (r3.ok && String(r3.seller._id)) === 'string');

  // ── 4. Genuinely new seller ───────────────────────────────────────────
  console.log('\n4. BRAND NEW SELLER');
  const r4 = await resolveSellerByUidOrPhone({ userId: 'idtest-nobody', verifiedPhone: '5559999999' });
  check('no UID + no phone match → NOT_FOUND', !r4.ok && r4.reason === 'NOT_FOUND');

  // ── 5. Different seller — must not cross-attach ────────────────────────
  console.log('\n5. DIFFERENT SELLER');
  const sA = await seed('idtest-A', '5550000010');
  const sB = await seed('idtest-B', '5550000011');
  const r5 = await resolveSellerByUidOrPhone({ userId: 'idtest-A-NEW', verifiedPhone: '5550000011' });
  check('phone of B → resolves B, never A', r5.ok && String(r5.ok && r5.seller._id) === String(sB._id));
  check('A was not returned', !(r5.ok && String(r5.ok && r5.seller._id) === String(sA._id)));

  // ── 6. Duplicate phone → fail safe ────────────────────────────────────
  console.log('\n6. DUPLICATE PHONE');
  await seed('idtest-dup-1', '5550000020');
  await seed('idtest-dup-2', '5550000020');
  const r6 = await resolveSellerByUidOrPhone({ userId: 'idtest-dup-NEW', verifiedPhone: '5550000020' });
  check('ambiguous phone → not rebound', !r6.ok && r6.reason === 'AMBIGUOUS');

  // ── 7. No verified phone → no unsafe fallback ─────────────────────────
  console.log('\n7. PHONE MISSING');
  const r7 = await resolveSellerByUidOrPhone({ userId: 'idtest-uid-1-NOPHONE' });
  check('UID miss + no phone → NOT_FOUND (no fallback)', !r7.ok && r7.reason === 'NOT_FOUND');

  // ── 8. Race — concurrent recovery ────────────────────────────────────
  console.log('\n8. RACE');
  const s8 = await seed('idtest-race-old', '5550000030');
  const settled = await Promise.all(
    Array.from({ length: 6 }, () => resolveSellerByUidOrPhone({ userId: 'idtest-race-NEW', verifiedPhone: '5550000030' })),
  );
  check('all 6 concurrent resolves succeed', settled.every((r) => r.ok));
  check('all return the same Seller._id', new Set(settled.map((r) => (r.ok ? String(r.seller._id) : 'x'))).size === 1);
  const raceCount = await Seller.countDocuments({ mobileNumber: '5550000030', userId: TAG });
  check('still exactly one seller for that phone', raceCount === 1);
  const s8after = await Seller.findById(s8._id).lean();
  check('userId rebound once, _id stable', s8after?.userId === 'idtest-race-NEW');

  // ── 9. registerSeller does not create a duplicate on UID rotation ─────
  console.log('\n9. registerSeller');
  const before = await Seller.countDocuments({ userId: TAG });
  const reg = await SellerService.registerSeller({
    userId: 'idtest-uid-1-REGNEW',
    fullName: 'ID Test',
    mobileNumber: '5550000001',
    verifiedPhone: '5550000001',
  });
  const after = await Seller.countDocuments({ userId: TAG });
  check('registerSeller returned the existing seller', String(reg._id) === String(s1._id));
  check('registerSeller created NO new row', after === before);

  await cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  await disconnectDatabase();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
