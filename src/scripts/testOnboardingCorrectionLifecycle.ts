import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';
import SellerApprovalHistory from '../models/SellerApprovalHistory';
import { SellerService } from '../services/SellerService';
import { AppError } from '../utils/response';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`❌ FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run() {
  await connectDatabase();
  console.log('\n======================================================');
  console.log('🧪 RUNNING: Seller Onboarding Review & Correction Lifecycle Test');
  console.log('======================================================\n');

  const ts = Date.now();
  const testUserId = `test-corr-user-${ts}`;
  const testPhone = `9${String(ts).slice(-9)}`;
  const adminId = `admin-verifier-${ts}`;

  // 1. Initial Registration
  console.log('Step 1: Seller initial registration');
  const seller = await Seller.create({
    userId: testUserId,
    fullName: 'Test Merchant',
    mobileNumber: testPhone,
    status: 'PENDING',
    onboardingStatus: 'DRAFT',
  });
  const sid = String(seller._id);
  assert(seller.onboardingStatus === 'DRAFT', 'Initial seller onboardingStatus is DRAFT');

  // Fill initial onboarding details
  await SellerService.saveOnboarding(
    sid,
    {
      fullName: 'Test Merchant',
      mobileNumber: testPhone,
      shopName: 'Fresh Mart',
      address: '100 Market St',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500001',
      pan: 'ABCDE1234F',
      gstin: '36ABCDE1234F1Z5',
      fssaiNumber: '12345678901234',
    },
    false
  );

  const obDoc = await SellerOnboarding.findOne({ sellerId: seller._id });
  assert(!!obDoc, 'Onboarding record created');
  assert(obDoc?.status === 'DRAFT', 'Onboarding status is DRAFT');
  obDoc!.panVerificationStatus = 'VERIFIED';
  obDoc!.gstinVerificationStatus = 'VERIFIED';
  await obDoc!.save();

  // Initial Document Upload
  await SellerDocument.create({
    sellerId: seller._id,
    onboardingId: obDoc!._id,
    documentType: 'FSSAI_CERTIFICATE',
    documentNumber: '12345678901234',
    fileUrl: 'https://storage.extrahand.in/docs/v1-fssai.jpg',
    fileName: 'v1-fssai.jpg',
    mimeType: 'image/jpeg',
    fileSize: 1024,
  });

  // 2. Seller Submits Application
  console.log('\nStep 2: Seller submits application for approval');
  await SellerService.saveOnboarding(sid, {}, true);

  let ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  let s = await Seller.findById(seller._id).lean();
  assert(ob?.status === 'PENDING_APPROVAL', 'Onboarding status transitioned to PENDING_APPROVAL');
  assert(s?.onboardingStatus === 'PENDING_APPROVAL', 'Seller onboardingStatus transitioned to PENDING_APPROVAL');

  let history = await SellerApprovalHistory.find({ sellerId: seller._id }).sort({ performedAt: 1 }).lean();
  assert(history.length === 1 && history[0].action === 'SUBMITTED', 'History recorded initial SUBMITTED action');

  // 3. Security: Edit Access Guarded during PENDING_APPROVAL
  console.log('\nStep 3: Verify backend rejects edits & duplicate submissions while under review');
  let editBlocked = false;
  try {
    await SellerService.saveOnboarding(sid, { shopName: 'Unauthorized Name Change' }, false);
  } catch (err: any) {
    if (err instanceof AppError && err.statusCode === 403) {
      editBlocked = true;
    }
  }
  assert(editBlocked, 'PUT edit rejected with 403 Forbidden while status is PENDING_APPROVAL');

  let duplicateSubmitBlocked = false;
  try {
    await SellerService.saveOnboarding(sid, {}, true);
  } catch (err: any) {
    if (err instanceof AppError && err.statusCode === 400) {
      duplicateSubmitBlocked = true;
    }
  }
  assert(duplicateSubmitBlocked, 'Duplicate submission rejected with 400 Bad Request');

  // 4. Admin Review Cycle 1: Request Correction
  console.log('\nStep 4: Admin reviews application - correction note requirement & request');
  let missingNoteBlocked = false;
  try {
    await SellerService.reviewOnboarding(sid, 'CHANGES_REQUESTED', '', adminId);
  } catch (err: any) {
    if (err instanceof AppError && err.statusCode === 400) {
      missingNoteBlocked = true;
    }
  }
  assert(missingNoteBlocked, 'Admin cannot request changes without a correction note');

  const noteCycle1 = 'Please upload a clearer FSSAI certificate. The current scan is blurry.';
  await SellerService.reviewOnboarding(sid, 'CHANGES_REQUESTED', noteCycle1, adminId);

  ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  s = await Seller.findById(seller._id).lean();
  assert(ob?.status === 'CHANGES_REQUIRED', 'Onboarding status transitioned to CHANGES_REQUIRED');
  assert(s?.onboardingStatus === 'CHANGES_REQUIRED', 'Seller onboardingStatus transitioned to CHANGES_REQUIRED');
  assert(ob?.adminComment === noteCycle1, 'adminComment contains Admin correction note');
  assert(ob?.lastCorrectionNote === noteCycle1, 'lastCorrectionNote preserved');

  history = await SellerApprovalHistory.find({ sellerId: seller._id }).sort({ performedAt: 1 }).lean();
  assert(
    history.length === 2 && history[1].action === 'CHANGES_REQUESTED' && history[1].comment === noteCycle1,
    'History recorded CHANGES_REQUESTED with correction note'
  );

  // 5. Seller Edits Application & Replaces Document
  console.log('\nStep 5: Seller has edit access, updates details and replaces document');
  await SellerService.saveOnboarding(sid, { shopDescription: 'Fresh local organic groceries' }, false);
  ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  assert(ob?.shopDescription === 'Fresh local organic groceries', 'Seller successfully edited description');

  // Seller replaces FSSAI document
  await SellerDocument.updateOne(
    { sellerId: seller._id, documentType: 'FSSAI_CERTIFICATE' },
    {
      fileUrl: 'https://storage.extrahand.in/docs/v2-clearer-fssai.jpg',
      fileName: 'v2-clearer-fssai.jpg',
      fileSize: 2048,
    }
  );
  const updatedDoc = await SellerDocument.findOne({ sellerId: seller._id, documentType: 'FSSAI_CERTIFICATE' }).lean();
  assert(updatedDoc?.fileName === 'v2-clearer-fssai.jpg', 'Seller successfully replaced FSSAI certificate document');

  // 6. Seller Resubmits (Cycle 1 Resubmission)
  console.log('\nStep 6: Seller resubmits application');
  await SellerService.saveOnboarding(sid, {}, true);

  ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  s = await Seller.findById(seller._id).lean();
  assert(ob?.status === 'PENDING_APPROVAL', 'Status transitioned back to PENDING_APPROVAL on resubmit');
  assert(s?.onboardingStatus === 'PENDING_APPROVAL', 'Seller onboardingStatus is PENDING_APPROVAL');
  assert(!ob?.adminComment, 'adminComment cleared on resubmit');
  assert(ob?.lastCorrectionNote === noteCycle1, 'lastCorrectionNote still retained for audit');

  history = await SellerApprovalHistory.find({ sellerId: seller._id }).sort({ performedAt: 1 }).lean();
  assert(history.length === 3 && history[2].action === 'RESUBMITTED', 'History recorded RESUBMITTED action');

  // Check edit access locked again
  editBlocked = false;
  try {
    await SellerService.saveOnboarding(sid, { shopName: 'Attempted Change' }, false);
  } catch (err: any) {
    if (err instanceof AppError && err.statusCode === 403) editBlocked = true;
  }
  assert(editBlocked, 'Edit access locked again after resubmission (403)');

  // 7. Multiple Review Cycles: Admin Requests 2nd Correction (Cycle 2)
  console.log('\nStep 7: Multiple Correction Cycles - Admin requests second correction');
  const noteCycle2 = 'FSSAI certificate is clear now. Please update your shop address with landmark.';
  await SellerService.reviewOnboarding(sid, 'CHANGES_REQUESTED', noteCycle2, adminId);

  ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  assert(ob?.status === 'CHANGES_REQUIRED', 'Status is CHANGES_REQUIRED for cycle 2');
  assert(ob?.adminComment === noteCycle2, 'Admin comment updated to cycle 2 note');
  assert(ob?.lastCorrectionNote === noteCycle2, 'lastCorrectionNote updated to cycle 2 note');

  // Seller corrects address and resubmits
  await SellerService.saveOnboarding(sid, { address: '100 Market St, Opp City Park', landmark: 'City Park' }, false);
  await SellerService.saveOnboarding(sid, {}, true);

  ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  assert(ob?.status === 'PENDING_APPROVAL', 'Status back to PENDING_APPROVAL after cycle 2 resubmit');
  assert(ob?.address === '100 Market St, Opp City Park', 'Corrected address persisted');

  history = await SellerApprovalHistory.find({ sellerId: seller._id }).sort({ performedAt: 1 }).lean();
  assert(history.length === 5, 'History contains all 5 lifecycle events across 2 correction cycles');

  // 8. Admin Approves Application
  console.log('\nStep 8: Admin approves application');
  await SellerService.reviewOnboarding(sid, 'APPROVE', undefined, adminId);

  ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  s = await Seller.findById(seller._id).lean();
  assert(ob?.status === 'APPROVED', 'Onboarding status transitioned to APPROVED');
  assert(s?.onboardingStatus === 'APPROVED', 'Seller onboardingStatus transitioned to APPROVED');
  assert(s?.status === 'ACTIVE', 'Seller status transitioned to ACTIVE');

  history = await SellerApprovalHistory.find({ sellerId: seller._id }).sort({ performedAt: 1 }).lean();
  assert(history.length === 6 && history[5].action === 'APPROVED', 'Final approval recorded in history');

  // 9. Post-Approval Edit Guard
  console.log('\nStep 9: Verify edit access locked after approval');
  editBlocked = false;
  try {
    await SellerService.saveOnboarding(sid, { shopName: 'Post Approval Edit' }, false);
  } catch (err: any) {
    if (err instanceof AppError && err.statusCode === 403) editBlocked = true;
  }
  assert(editBlocked, 'Edits blocked with 403 Forbidden after approval');

  // Cleanup
  console.log('\nStep 10: Cleaning up test data');
  await Promise.all([
    Seller.deleteOne({ _id: seller._id }),
    SellerOnboarding.deleteMany({ sellerId: seller._id }),
    SellerDocument.deleteMany({ sellerId: seller._id }),
    SellerApprovalHistory.deleteMany({ sellerId: seller._id }),
  ]);

  console.log('\n======================================================');
  console.log('✅ ALL ONBOARDING CORRECTION LIFECYCLE TESTS PASSED!');
  console.log('======================================================\n');
  await disconnectDatabase();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
