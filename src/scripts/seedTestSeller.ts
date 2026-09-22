/**
 * Seed a test seller account for phone 9999999999.
 *
 * Run from the extrahand-qcommerce-admin-backend directory:
 *   npx ts-node src/scripts/seedTestSeller.ts
 *
 * What it does:
 *   1. Creates (or reuses) a Seller row for 9999999999.
 *   2. Creates (or reuses) a full SellerOnboarding record with PAN + GSTIN
 *      already marked as VERIFIED (bypass — no real API call needed).
 *   3. Submits the application → status: PENDING_APPROVAL.
 *   4. Approves the application → seller becomes ACTIVE / APPROVED.
 *
 * After running this script you can log in on the Shopkeeper app with:
 *   Phone : 9999999999
 *   OTP   : 123456  (static test bypass)
 */

import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerApprovalHistory from '../models/SellerApprovalHistory';

// ─── Config ─────────────────────────────────────────────────────────────────
const TEST_PHONE = '9999999999';
const TEST_UID   = 'test-seller-uid-9999999999'; // stable fake Firebase UID
const ADMIN_ID   = 'seed-script';

async function main() {
  await connectDatabase();
  console.log('\n🔧  Seeding test seller for phone:', TEST_PHONE);

  // ── 1. Seller row ─────────────────────────────────────────────────────────
  let seller = await Seller.findOne({ mobileNumber: TEST_PHONE });
  if (seller) {
    console.log('   Found existing Seller:', String(seller._id));
    // Reset to a clean state so we can re-run the script any time.
    seller.userId          = TEST_UID;
    seller.fullName        = 'Test Seller';
    seller.status          = 'PENDING';
    seller.onboardingStatus = 'DRAFT';
    await seller.save();
    console.log('   Reset Seller to PENDING / DRAFT');
  } else {
    seller = await Seller.create({
      userId:          TEST_UID,
      fullName:        'Test Seller',
      mobileNumber:    TEST_PHONE,
      status:          'PENDING',
      onboardingStatus: 'DRAFT',
    });
    console.log('   Created new Seller:', String(seller._id));
  }

  const sellerId = String(seller._id);

  // ── 2. SellerOnboarding row ───────────────────────────────────────────────
  // Wipe any stale history + onboarding so the submission below starts fresh.
  await SellerOnboarding.deleteMany({ sellerId: seller._id });
  await SellerApprovalHistory.deleteMany({ sellerId: seller._id });

  const onboarding = await SellerOnboarding.create({
    sellerId: seller._id,
    fullName:        'Test Seller',
    mobileNumber:    TEST_PHONE,
    shopName:        'Test Shop',
    shopType:        'Grocery',
    address:         '1 Seed Lane, Begumpet',
    formattedAddress:'1 Seed Lane, Begumpet, Hyderabad, Telangana 500016',
    area:            'Begumpet',
    locality:        'Begumpet',
    city:            'Hyderabad',
    district:        'Hyderabad',
    state:           'Telangana',
    country:         'India',
    pincode:         '500016',
    latitude:        17.4415,
    longitude:       78.4671,
    // PAN + GSTIN pre-marked VERIFIED — bypasses the real verification API
    pan:                    'ABCDE1234F',
    panVerificationStatus:  'VERIFIED',
    panVerifiedAt:          new Date(),
    panVerifiedName:        'TEST SELLER',
    gstin:                  '36ABCDE1234F1Z5',
    gstinVerificationStatus: 'VERIFIED',
    gstinVerifiedAt:         new Date(),
    gstinVerifiedLegalName:  'TEST SELLER PRIVATE LIMITED',
    gstinVerifiedTradeName:  'TEST SHOP',
    status: 'DRAFT',
  });
  console.log('   Created SellerOnboarding:', String(onboarding._id));

  // ── 3. Submit → PENDING_APPROVAL ─────────────────────────────────────────
  onboarding.status      = 'PENDING_APPROVAL';
  onboarding.submittedAt = new Date();
  await onboarding.save();

  seller.onboardingStatus = 'PENDING_APPROVAL';
  await seller.save();

  await SellerApprovalHistory.create({
    sellerId:       seller._id,
    onboardingId:   onboarding._id,
    action:         'SUBMITTED',
    previousStatus: 'DRAFT',
    newStatus:      'PENDING_APPROVAL',
    performedBy:    TEST_UID,
  });
  console.log('   Submitted → PENDING_APPROVAL');

  // ── 4. Approve ────────────────────────────────────────────────────────────
  onboarding.status     = 'APPROVED';
  onboarding.reviewedAt = new Date();
  onboarding.reviewedBy = ADMIN_ID;
  await onboarding.save();

  seller.status           = 'ACTIVE';
  seller.onboardingStatus = 'APPROVED';
  await seller.save();

  await SellerApprovalHistory.create({
    sellerId:       seller._id,
    onboardingId:   onboarding._id,
    action:         'APPROVED',
    previousStatus: 'PENDING_APPROVAL',
    newStatus:      'APPROVED',
    performedBy:    ADMIN_ID,
  });
  console.log('   Approved → ACTIVE / APPROVED ✅');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n📋  Done!');
  console.log('   Seller ID        :', sellerId);
  console.log('   userId (fake UID):', TEST_UID);
  console.log('   Phone            :', TEST_PHONE);
  console.log('   Seller status    : ACTIVE');
  console.log('   Onboarding status: APPROVED');
  console.log('\n🚀  Login on the Shopkeeper app:');
  console.log('   Phone : 9999999999');
  console.log('   OTP   : 123456');
  console.log('\n   Note: The app will login via Firebase / user-service.');
  console.log('   The QC backend resolves the seller by phone (phoneVariants)');
  console.log('   and will rebind the userId to your real Firebase UID on first login.');
  console.log('   This is the same heal mechanism used for all sellers.\n');

  await disconnectDatabase();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n❌  Seed failed:', err.message || err);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});

