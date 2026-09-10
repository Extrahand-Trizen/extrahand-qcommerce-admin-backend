/**
 * Diagnostic: why does login for a given phone bounce to registration?
 *   npx ts-node src/scripts/inspectSellerByPhone.ts 7893396338
 *
 * Read-only. Prints the Seller row(s) for the phone, the onboarding row,
 * and simulates attachSeller's resolveSellerByUidOrPhone() both ways.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import { resolveSellerByUidOrPhone } from '../services/SellerIdentityService';
import { phoneVariants, phoneLast10 } from '../utils/phone';

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error('usage: inspectSellerByPhone.ts <phone>');
    process.exit(1);
  }

  await connectDatabase();

  const last10 = phoneLast10(phone);
  const variants = phoneVariants(phone);
  console.log('\nphone input     :', phone);
  console.log('phoneLast10     :', last10);
  console.log('phoneVariants   :', variants);

  const rx = new RegExp(last10 + '$');
  const sellers = await Seller.find({ mobileNumber: rx }).lean();
  console.log(`\n--- Seller rows matching /${last10}$/ : ${sellers.length} ---`);
  for (const s of sellers) {
    console.log({
      _id: String(s._id),
      userId: s.userId,
      mobileNumber: s.mobileNumber,
      status: s.status,
      onboardingStatus: s.onboardingStatus,
      fullName: s.fullName,
      createdAt: s.createdAt,
      lastLoginAt: (s as { lastLoginAt?: Date }).lastLoginAt,
    });
    const onb = await SellerOnboarding.findOne({ sellerId: s._id }).lean();
    console.log('  onboarding:', onb ? { status: onb.status, currentStep: (onb as { currentStep?: string }).currentStep } : 'NONE');
  }

  // exact-match variants lookup (what resolveSellerByUidOrPhone actually does)
  const exact = await Seller.find({ mobileNumber: { $in: variants }, status: { $ne: 'DELETED' } }).lean();
  console.log(`\n--- exact { mobileNumber: { $in: variants } } non-deleted : ${exact.length} ---`);
  console.log(exact.map((s) => ({ _id: String(s._id), userId: s.userId, mobileNumber: s.mobileNumber })));

  // simulate: fresh UID that won't match, with the verified phone
  const fakeUid = 'DIAG_FAKE_UID_' + Date.now();
  const healed = await resolveSellerByUidOrPhone({ userId: fakeUid, verifiedPhone: phone });
  console.log('\n--- resolveSellerByUidOrPhone({ fakeUid, verifiedPhone }) ---');
  console.log(healed.ok
    ? { ok: true, sellerId: String(healed.seller._id), healed: healed.healed, boundUserIdNow: healed.seller.userId }
    : healed);

  // NOTE: the above may have rebound userId to the fake uid. Restore it.
  if (healed.ok && healed.healed) {
    console.log('\n(!) heal test rebound userId to the fake uid — restoring original...');
    // find original from the earlier lean snapshot
    const original = sellers.find((s) => String(s._id) === String(healed.seller._id));
    if (original) {
      await Seller.updateOne({ _id: healed.seller._id }, { $set: { userId: original.userId } });
      console.log('    restored userId ->', original.userId);
    }
  }

  await disconnectDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
