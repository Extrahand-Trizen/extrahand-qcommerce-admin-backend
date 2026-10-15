import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
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
  console.log('\n=== Running Aadhaar Verification Security & Anti-Tampering Tests ===\n');

  const ts = Date.now();
  const seller = await Seller.create({
    userId: `aadhaar-sec-test-${ts}`,
    fullName: 'Aadhaar Security Tester',
    mobileNumber: `9${String(ts).slice(-9)}`,
    status: 'PENDING',
    onboardingStatus: 'DRAFT',
  });
  const sid = String(seller._id);

  try {
    // Test 1: Anti-Tampering: Client cannot directly inject aadhaarVerificationStatus: 'VERIFIED'
    console.log('Test 1: Anti-Tampering - client cannot inject aadhaarVerificationStatus: VERIFIED');
    await SellerService.saveOnboarding(sid, {
      fullName: 'Aadhaar Security Tester',
      // @ts-ignore
      aadhaarVerificationStatus: 'VERIFIED',
      // @ts-ignore
      aadhaarVerifiedAt: new Date(),
      // @ts-ignore
      aadhaarVerifiedName: 'FAKE INJECTED NAME',
    }, false);

    let ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(!!ob, 'Onboarding record created');
    assert(ob!.aadhaarVerificationStatus === 'NOT_VERIFIED', 'Client-injected aadhaarVerificationStatus was stripped and remains NOT_VERIFIED');
    assert(!ob!.aadhaarVerifiedName, 'Client-injected aadhaarVerifiedName was stripped');

    // Test 2: Regex pattern check alone does NOT mark Aadhaar as VERIFIED
    console.log('\nTest 2: Valid 12-digit Aadhaar pattern does NOT mark Aadhaar as VERIFIED without OCR');
    await SellerService.saveOnboarding(sid, {
      aadhaarNumber: '987654321098',
    }, false);
    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.aadhaarNumber === '987654321098', 'Aadhaar number saved');
    assert(ob!.aadhaarVerificationStatus === 'NOT_VERIFIED', 'Valid 12-digit pattern does NOT mark status as VERIFIED');
    assert(ob!.aadhaarOcrStatus === 'NOT_VERIFIED', 'aadhaarOcrStatus remains NOT_VERIFIED');

    // Test 3: Changing Aadhaar number invalidates previously established verification
    console.log('\nTest 3: Changing Aadhaar number invalidates existing verification');
    ob!.aadhaarVerificationStatus = 'VERIFIED';
    ob!.aadhaarOcrStatus = 'VERIFIED';
    ob!.aadhaarVerifiedName = 'Aadhaar Security Tester';
    ob!.aadhaarVerifiedAt = new Date();
    await ob!.save();

    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.aadhaarVerificationStatus === 'VERIFIED', 'Setup: Aadhaar is marked VERIFIED');

    await SellerService.saveOnboarding(sid, {
      aadhaarNumber: '234567890123',
    }, false);
    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.aadhaarNumber === '234567890123', 'Aadhaar number updated');
    assert(ob!.aadhaarVerificationStatus === 'NOT_VERIFIED', 'Verification invalidated to NOT_VERIFIED on number change');
    assert(ob!.aadhaarOcrStatus === 'NOT_VERIFIED', 'OCR status reset to NOT_VERIFIED');
    assert(!ob!.aadhaarVerifiedName, 'Verified name cleared');

    // Test 4: Changing front image invalidates previously established verification
    console.log('\nTest 4: Replacing front image URL invalidates existing verification');
    ob!.aadhaarVerificationStatus = 'VERIFIED';
    ob!.aadhaarOcrStatus = 'VERIFIED';
    ob!.aadhaarFrontImageUrl = 'https://example.com/front_original.jpg';
    ob!.aadhaarBackImageUrl = 'https://example.com/back_original.jpg';
    ob!.aadhaarVerifiedName = 'Aadhaar Security Tester';
    await ob!.save();

    await SellerService.saveOnboarding(sid, {
      aadhaarFrontImageUrl: 'https://example.com/new_unverified_front.jpg',
    }, false);
    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.aadhaarVerificationStatus === 'NOT_VERIFIED', 'Verification invalidated to NOT_VERIFIED when front image changes');
    assert(!ob!.aadhaarVerifiedName, 'Verified name cleared');

    // Test 5: Changing back image invalidates previously established verification
    console.log('\nTest 5: Replacing back image URL invalidates existing verification');
    ob!.aadhaarVerificationStatus = 'VERIFIED';
    ob!.aadhaarOcrStatus = 'VERIFIED';
    ob!.aadhaarFrontImageUrl = 'https://example.com/front_original.jpg';
    ob!.aadhaarBackImageUrl = 'https://example.com/back_original.jpg';
    ob!.aadhaarVerifiedName = 'Aadhaar Security Tester';
    await ob!.save();

    await SellerService.saveOnboarding(sid, {
      aadhaarBackImageUrl: 'https://example.com/new_unverified_back.jpg',
    }, false);
    ob = await SellerOnboarding.findOne({ sellerId: seller._id });
    assert(ob!.aadhaarVerificationStatus === 'NOT_VERIFIED', 'Verification invalidated to NOT_VERIFIED when back image changes');
    assert(!ob!.aadhaarVerifiedName, 'Verified name cleared');

    // Test 6: Final submission blocked when Aadhaar is unverified
    console.log('\nTest 6: Final submission blocked when Aadhaar is NOT_VERIFIED');
    let submissionBlocked = false;
    try {
      await SellerService.saveOnboarding(sid, {}, true);
    } catch (err: any) {
      submissionBlocked = true;
      assert(err.message.includes('Aadhaar must be verified'), `Submission threw expected error: ${err.message}`);
    }
    assert(submissionBlocked, 'Submission blocked because Aadhaar is not verified');

    console.log('\n🎉 ALL AADHAAR VERIFICATION SECURITY TESTS PASSED!\n');
  } finally {
    await SellerOnboarding.deleteMany({ sellerId: seller._id });
    await Seller.deleteMany({ _id: seller._id });
    await disconnectDatabase();
  }
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
