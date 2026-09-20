import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';
import { SellerService } from '../services/SellerService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function run() {
  await connectDatabase();
  console.log('\n=== Running Business Verification Lifecycle Tests ===\n');

  const ts = Date.now();
  const seller = await Seller.create({
    userId: `verify-test-user-${ts}`,
    fullName: 'Business Verification Tester',
    mobileNumber: `9${String(ts).slice(-9)}`,
    status: 'PENDING',
    onboardingStatus: 'DRAFT',
  });
  const sid = String(seller._id);

  try {
    // 1. Initial draft creation
    console.log('Test 1: Create draft onboarding with PAN and GSTIN');
    const baseFields = {
      fullName: 'Business Verification Tester',
      mobileNumber: `9${String(ts).slice(-9)}`,
      shopName: `Store ${ts}`,
      address: '100 Main Road',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500001',
      pan: 'ABCDE1234F',
      gstin: '36ABCDE1234F1Z5',
      fssaiNumber: '12345678901234',
    };

    await SellerService.saveOnboarding(sid, baseFields, false);
    let ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(!!ob, 'Onboarding draft record exists');
    assert(ob!.panVerificationStatus === 'NOT_VERIFIED', 'Initial panVerificationStatus is NOT_VERIFIED');
    assert(ob!.gstinVerificationStatus === 'NOT_VERIFIED', 'Initial gstinVerificationStatus is NOT_VERIFIED');

    // Add required FSSAI document so submission check reaches verification checks
    await SellerDocument.create({
      sellerId: seller._id,
      onboardingId: ob!._id,
      documentType: 'FSSAI_CERTIFICATE',
      documentNumber: '12345678901234',
      fileUrl: 'https://example.com/fssai.jpg',
      fileName: 'fssai.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    });

    // 2. Submission blocked when unverified
    console.log('\nTest 2: Final submission blocked when unverified');
    let submissionBlocked = false;
    try {
      await SellerService.saveOnboarding(sid, {}, true);
    } catch (err: any) {
      submissionBlocked = true;
      assert(err.message.includes('PAN must be verified') || err.message.includes('GSTIN must be verified'),
        `Submission threw expected error: ${err.message}`);
    }
    assert(submissionBlocked, 'Submission was blocked due to missing PAN/GSTIN verification');

    // 3. Client tampering prevention (Rule 15)
    console.log('\nTest 3: Anti-tampering check (client cannot inject VERIFIED status directly)');
    await SellerService.saveOnboarding(sid, {
      // @ts-ignore
      panVerificationStatus: 'VERIFIED',
      // @ts-ignore
      gstinVerificationStatus: 'VERIFIED',
    }, false);
    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.panVerificationStatus === 'NOT_VERIFIED', 'Client-injected panVerificationStatus was stripped/ignored');
    assert(ob!.gstinVerificationStatus === 'NOT_VERIFIED', 'Client-injected gstinVerificationStatus was stripped/ignored');

    // 4. Simulate backend marking verification status (as done by verifySellerPAN & verifySellerGSTIN)
    console.log('\nTest 4: Set backend verification status');
    ob!.panVerificationStatus = 'VERIFIED';
    ob!.panVerifiedAt = new Date();
    ob!.panVerifiedName = 'BUSINESS TESTER';
    ob!.gstinVerificationStatus = 'VERIFIED';
    ob!.gstinVerifiedAt = new Date();
    ob!.gstinVerifiedLegalName = 'TEST ENTERPRISE PRIVATE LIMITED';
    ob!.gstinVerifiedTradeName = 'STORE TEST';
    await ob!.save();

    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.panVerificationStatus === 'VERIFIED', 'PAN is verified');
    assert(ob!.gstinVerificationStatus === 'VERIFIED', 'GSTIN is verified');

    // 5. Invalidation on PAN change (Rule 14)
    console.log('\nTest 5: Changing PAN resets PAN verification to NOT_VERIFIED');
    await SellerService.saveOnboarding(sid, { pan: 'XYZAB5678C' }, false);
    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.pan === 'XYZAB5678C', 'PAN was updated to new value');
    assert(ob!.panVerificationStatus === 'NOT_VERIFIED', 'panVerificationStatus was automatically reset to NOT_VERIFIED');
    assert(ob!.gstinVerificationStatus === 'VERIFIED', 'gstinVerificationStatus remained VERIFIED');

    // Re-verify PAN
    ob!.panVerificationStatus = 'VERIFIED';
    await ob!.save();

    // 6. Invalidation on GSTIN change (Rule 14)
    console.log('\nTest 6: Changing GSTIN resets GSTIN verification to NOT_VERIFIED');
    await SellerService.saveOnboarding(sid, { gstin: '29AAICP2912R1ZR' }, false);
    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.gstin === '29AAICP2912R1ZR', 'GSTIN was updated to new value');
    assert(ob!.gstinVerificationStatus === 'NOT_VERIFIED', 'gstinVerificationStatus was automatically reset to NOT_VERIFIED');
    assert(ob!.panVerificationStatus === 'VERIFIED', 'panVerificationStatus remained VERIFIED');

    // Re-verify GSTIN
    ob!.gstinVerificationStatus = 'VERIFIED';
    await ob!.save();

    // 7. Successful submission when both are VERIFIED (Rule 16)
    console.log('\nTest 7: Submission succeeds when both are VERIFIED');
    await SellerService.saveOnboarding(sid, {}, true);
    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.status === 'PENDING_APPROVAL', 'Application status transitioned to PENDING_APPROVAL');

    console.log('\n🎉 ALL BUSINESS VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    // Cleanup
    await SellerDocument.deleteMany({ sellerId: seller._id });
    await SellerOnboarding.deleteMany({ sellerId: seller._id });
    await Seller.deleteMany({ _id: seller._id });
    await disconnectDatabase();
  }
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
