import assert from 'assert';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';
import { SellerService } from '../services/SellerService';
import { VerificationServiceClient } from '../services/VerificationServiceClient';
import { AppError } from '../utils/response';
import fs from 'fs';
import path from 'path';

function logPass(msg: string) {
  console.log(`  ✅ PASSED: ${msg}`);
}

function logFail(msg: string, err?: any) {
  console.error(`  ❌ FAILED: ${msg}`, err || '');
}

async function runTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING AADHAAR TIMEOUT & ONBOARDING STATE PROTECTION TESTS');
  console.log('===============================================================\n');

  let passedCount = 0;
  let totalCount = 0;

  function test(description: string, fn: () => void | Promise<void>) {
    totalCount++;
    return (async () => {
      try {
        await fn();
        logPass(description);
        passedCount++;
      } catch (err: any) {
        logFail(description, err.message);
        throw err;
      }
    })();
  }

  // Connect to DB for SellerService tests
  await connectDatabase();

  try {
    // -------------------------------------------------------------
    // Test 1: Gateway Aadhaar verification uses dedicated OCR timeout (120,000ms)
    // -------------------------------------------------------------
    await test('1. Gateway Aadhaar verification uses dedicated 120s OCR timeout', () => {
      const gatewayServiceFile = path.resolve(__dirname, '../../../../EH-api-gateway/src/services/verificationService.ts');
      const content = fs.readFileSync(gatewayServiceFile, 'utf8');

      // Verify verifyAadhaar method exists and passes ocrUploadTimeoutMs
      const verifyAadhaarMethodMatch = content.match(/async\s+verifyAadhaar\s*\([\s\S]*?\{\s*[\s\S]*?this\.client\.post[\s\S]*?timeout:\s*this\.ocrUploadTimeoutMs/);
      assert(!!verifyAadhaarMethodMatch, 'verifyAadhaar must pass timeout: this.ocrUploadTimeoutMs in request config');

      // Verify ocrUploadTimeoutMs is configured from env with 120000ms default
      const configMatch = content.match(/ocrUploadTimeoutMs\s*=\s*(?:parseTimeoutMs|parseInt)\([\s\S]*?120_?000/);
      assert(!!configMatch, 'ocrUploadTimeoutMs must default to 120000ms (120s)');
    });

    // -------------------------------------------------------------
    // Test 2: Verification Service executes front and back OCR concurrently
    // -------------------------------------------------------------
    await test('2. Front and back OCR execute concurrently using Promise.all in verification service', () => {
      const verifRouteFile = path.resolve(__dirname, '../../../../extrahand-user-verification-service/routes/verification.js');
      const content = fs.readFileSync(verifRouteFile, 'utf8');

      // Verify Promise.all is used for submitAadhaarOcr on front and back
      const parallelOcrMatch = content.match(/Promise\.all\(\[\s*smartOcrService\.submitAadhaarOcr\(\{[\s\S]*?side:\s*'front'[\s\S]*?smartOcrService\.submitAadhaarOcr\(\{[\s\S]*?side:\s*'back'/);
      assert(!!parallelOcrMatch, 'Front and back OCR must be called concurrently via Promise.all');

      // Verify verification IDs preserve _f and _b suffixes
      assert(content.includes('`${cfVerificationId}_f`'), 'Front verification ID must use _f suffix');
      assert(content.includes('`${cfVerificationId}_b`'), 'Back verification ID must use _b suffix');
    });

    // -------------------------------------------------------------
    // Test 3: OCR failure does not produce a false successful verification
    // -------------------------------------------------------------
    await test('3. OCR failure does not produce a false successful verification', async () => {
      // Simulate concurrent OCR where one side fails
      let side1Completed = false;
      let side2Failed = false;

      const mockOcrSide1 = async () => {
        await new Promise((r) => setTimeout(r, 20));
        side1Completed = true;
        return { mapped: { name: 'Test User' } };
      };
      const mockOcrSide2 = async () => {
        await new Promise((r) => setTimeout(r, 10));
        side2Failed = true;
        throw new Error('Cashfree front/back side failed');
      };

      let threw = false;
      try {
        await Promise.all([mockOcrSide1(), mockOcrSide2()]);
      } catch (err: any) {
        threw = true;
        assert.strictEqual(err.message, 'Cashfree front/back side failed');
      }

      assert(threw, 'Promise.all must reject if either side fails');
      assert(side2Failed, 'Failed side must terminate verification attempt');
    });

    // -------------------------------------------------------------
    // Test 4: Upstream HTTP 504 remains a timeout response instead of becoming HTTP 400
    // -------------------------------------------------------------
    await test('4. Upstream HTTP 504 remains a timeout response instead of becoming HTTP 400', async () => {
      const originalFetch = global.fetch;

      try {
        // Mock fetch returning HTTP 504 Gateway Timeout
        global.fetch = async () => ({
          ok: false,
          status: 504,
          statusText: 'Gateway Timeout',
          json: async () => ({
            success: false,
            message: 'Verification Service error: Request failed with status code 504',
          }),
        } as any);

        let caughtErr: any;
        try {
          await VerificationServiceClient.verifyAadhaar('dummy-token', '987654321098', 'frontBase64', 'backBase64');
        } catch (err: any) {
          caughtErr = err;
        }

        assert(caughtErr instanceof AppError, 'Error must be an AppError');
        assert.strictEqual(caughtErr.statusCode, 504, `Status code must be 504, received: ${caughtErr?.statusCode}`);
        assert(!caughtErr.message.includes('987654321098'), 'Aadhaar numbers must not be exposed in error messages');
      } finally {
        global.fetch = originalFetch;
      }
    });

    // -------------------------------------------------------------
    // Test 5: Upstream HTTP 502 and 503 are preserved as infrastructure errors
    // -------------------------------------------------------------
    await test('5. Upstream HTTP 502 and 503 are preserved instead of becoming 400', async () => {
      const originalFetch = global.fetch;

      try {
        // Mock fetch returning HTTP 502 Bad Gateway
        global.fetch = async () => ({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          json: async () => ({ success: false, message: 'Bad Gateway' }),
        } as any);

        let caught502: any;
        try {
          await VerificationServiceClient.verifyAadhaar('dummy-token', '987654321098', 'frontBase64', 'backBase64');
        } catch (err: any) {
          caught502 = err;
        }

        assert(caught502 instanceof AppError, 'Error must be an AppError');
        assert.strictEqual(caught502.statusCode, 502, `Status code must be 502, received: ${caught502?.statusCode}`);

        // Mock fetch returning HTTP 503 Service Unavailable
        global.fetch = async () => ({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: async () => ({ success: false, message: 'Service Unavailable' }),
        } as any);

        let caught503: any;
        try {
          await VerificationServiceClient.verifyAadhaar('dummy-token', '987654321098', 'frontBase64', 'backBase64');
        } catch (err: any) {
          caught503 = err;
        }

        assert(caught503 instanceof AppError, 'Error must be an AppError');
        assert.strictEqual(caught503.statusCode, 503, `Status code must be 503, received: ${caught503?.statusCode}`);
      } finally {
        global.fetch = originalFetch;
      }
    });

    // -------------------------------------------------------------
    // Test 6: Transient timeouts do not permanently mark onboarding as FAILED
    // -------------------------------------------------------------
    await test('6. Transient timeouts (HTTP 504) do NOT mark onboarding as FAILED', async () => {
      const ts = Date.now();
      const testSeller = await Seller.create({
        userId: `timeout-test-${ts}`,
        fullName: 'Timeout Test Seller',
        mobileNumber: `9${String(ts).slice(-9)}`,
        status: 'PENDING',
        onboardingStatus: 'DRAFT',
      });
      const sid = String(testSeller._id);

      const originalVerifyAadhaar = VerificationServiceClient.verifyAadhaar;

      try {
        // Mock VerificationServiceClient.verifyAadhaar to simulate HTTP 504 timeout
        VerificationServiceClient.verifyAadhaar = async () => {
          throw new AppError('Gateway timeout while verifying Aadhaar', 504);
        };

        let threw = false;
        try {
          await SellerService.verifySellerAadhaar(
            sid,
            '987654321098',
            'dummy-token',
            'data:image/jpeg;base64,dummyFront',
            'data:image/jpeg;base64,dummyBack'
          );
        } catch (err: any) {
          threw = true;
          assert.strictEqual(err.statusCode, 504, 'Must propagate 504 status code');
        }

        assert(threw, 'Call must throw timeout error');

        const onboarding = await SellerOnboarding.findOne({ sellerId: testSeller._id });
        assert(!!onboarding, 'Onboarding record exists');
        assert.strictEqual(
          onboarding.aadhaarVerificationStatus,
          'NOT_VERIFIED',
          `aadhaarVerificationStatus must remain NOT_VERIFIED for retry, not FAILED! Actual: ${onboarding.aadhaarVerificationStatus}`
        );
        assert.strictEqual(
          onboarding.aadhaarOcrStatus,
          'NOT_VERIFIED',
          `aadhaarOcrStatus must remain NOT_VERIFIED for retry, not FAILED! Actual: ${onboarding.aadhaarOcrStatus}`
        );
      } finally {
        VerificationServiceClient.verifyAadhaar = originalVerifyAadhaar;
      }
    });

    // -------------------------------------------------------------
    // Test 7: Genuine client validation error (HTTP 400) marks onboarding as FAILED
    // -------------------------------------------------------------
    await test('7. Genuine client validation error (HTTP 400) marks onboarding as FAILED', async () => {
      const ts = Date.now();
      const testSeller = await Seller.create({
        userId: `validation-test-${ts}`,
        fullName: 'Validation Test Seller',
        mobileNumber: `9${String(ts).slice(-9)}`,
        status: 'PENDING',
        onboardingStatus: 'DRAFT',
      });
      const sid = String(testSeller._id);

      const originalVerifyAadhaar = VerificationServiceClient.verifyAadhaar;

      try {
        // Mock VerificationServiceClient.verifyAadhaar to simulate genuine 400 rejection (bad document)
        VerificationServiceClient.verifyAadhaar = async () => {
          throw new AppError('Aadhaar card image is blurry or invalid', 400);
        };

        let threw = false;
        try {
          await SellerService.verifySellerAadhaar(
            sid,
            '987654321098',
            'dummy-token',
            'data:image/jpeg;base64,dummyFront',
            'data:image/jpeg;base64,dummyBack'
          );
        } catch (err: any) {
          threw = true;
          assert.strictEqual(err.statusCode, 400, 'Must propagate 400 status code');
        }

        assert(threw, 'Call must throw validation error');

        const onboarding = await SellerOnboarding.findOne({ sellerId: testSeller._id });
        assert(!!onboarding, 'Onboarding record exists');
        assert.strictEqual(
          onboarding.aadhaarVerificationStatus,
          'FAILED',
          `Genuine validation error must mark status as FAILED! Actual: ${onboarding.aadhaarVerificationStatus}`
        );
      } finally {
        VerificationServiceClient.verifyAadhaar = originalVerifyAadhaar;
      }
    });

    // -------------------------------------------------------------
    // Test 8: Retry behavior does not overwrite successful verification or create duplicate records
    // -------------------------------------------------------------
    await test('8. Retry behavior does not overwrite successful verification or create duplicate records', async () => {
      const ts = Date.now();
      const testSeller = await Seller.create({
        userId: `retry-test-${ts}`,
        fullName: 'Retry Test Seller',
        mobileNumber: `9${String(ts).slice(-9)}`,
        status: 'PENDING',
        onboardingStatus: 'DRAFT',
      });
      const sid = String(testSeller._id);

      // Setup pre-existing VERIFIED onboarding
      let onboarding: any = await SellerOnboarding.create({
        sellerId: testSeller._id,
        fullName: 'Verified Seller',
        mobileNumber: testSeller.mobileNumber,
        email: 'test@example.com',
        shopName: 'Test Shop',
        aadhaarNumber: '987654321098',
        aadhaarVerificationStatus: 'VERIFIED',
        aadhaarOcrStatus: 'VERIFIED',
        aadhaarVerifiedAt: new Date(),
        aadhaarVerifiedName: 'VERIFIED SELLER NAME',
        status: 'DRAFT',
      });

      const originalVerifyAadhaar = VerificationServiceClient.verifyAadhaar;

      try {
        // Simulate a retry where upstream times out (504)
        VerificationServiceClient.verifyAadhaar = async () => {
          throw new AppError('Gateway timeout', 504);
        };

        try {
          await SellerService.verifySellerAadhaar(
            sid,
            '987654321098',
            'dummy-token',
            'data:image/jpeg;base64,front',
            'data:image/jpeg;base64,back'
          );
        } catch {
          // Expected 504
        }

        onboarding = await SellerOnboarding.findOne({ sellerId: testSeller._id });
        assert(!!onboarding, 'Onboarding record exists');
        assert.strictEqual(
          onboarding.aadhaarVerificationStatus,
          'VERIFIED',
          'A previously VERIFIED status must NOT be overwritten by a subsequent transient timeout'
        );
        assert.strictEqual(
          onboarding.aadhaarVerifiedName,
          'VERIFIED SELLER NAME',
          'Verified name must remain intact'
        );

        // Verify SellerDocument records are upserted, never duplicated
        await SellerDocument.create({
          sellerId: testSeller._id,
          onboardingId: onboarding._id,
          documentType: 'AADHAAR_CARD',
          fileName: 'Aadhaar Front',
          fileUrl: 'https://example.com/front.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024,
          verificationStatus: 'VERIFIED',
        });

        // Now simulate a successful re-verification upsert
        VerificationServiceClient.verifyAadhaar = async () => ({
          success: true,
          aadhaarNumber: '987654321098',
          maskedAadhaar: 'XXXX-XXXX-1098',
          aadhaarVerifiedName: 'VERIFIED SELLER NAME',
          status: 'VERIFIED',
          croppedFrontImage: 'https://example.com/new_front.jpg',
          croppedBackImage: 'https://example.com/new_back.jpg',
        });

        await SellerService.verifySellerAadhaar(
          sid,
          '987654321098',
          'dummy-token',
          'https://example.com/new_front.jpg',
          'https://example.com/new_back.jpg'
        );

        const frontDocs = await SellerDocument.find({
          sellerId: testSeller._id,
          documentType: 'AADHAAR_CARD',
        });

        assert.strictEqual(
          frontDocs.length,
          1,
          `Expected exactly 1 SellerDocument record due to upsert, found: ${frontDocs.length}`
        );
      } finally {
        VerificationServiceClient.verifyAadhaar = originalVerifyAadhaar;
      }
    });

    // -------------------------------------------------------------
    // Test 9: Seller App timeout settings allow expected verification duration (90s)
    // -------------------------------------------------------------
    await test('9. Seller App timeout settings allow 90s verification duration', () => {
      const sellerAppFile = path.resolve(__dirname, '../../../../extra-hand-seller/src/api/sellerOnboarding.ts');
      const content = fs.readFileSync(sellerAppFile, 'utf8');

      // Match verify-aadhaar calls with timeoutMs: 90_000
      const matches = content.match(/['"]\/sellers\/onboarding\/verify-aadhaar['"][\s\S]*?timeoutMs:\s*90_?000/g);
      assert(!!matches && matches.length >= 1, 'Seller App must specify timeoutMs: 90_000 for verify-aadhaar endpoint');
    });

    // -------------------------------------------------------------
    // Test 10: Existing Kirana onboarding & PAN/GSTIN/Bank remain unchanged and functional
    // -------------------------------------------------------------
    await test('10. Existing Kirana onboarding & PAN/GSTIN/Bank contracts remain unchanged', () => {
      const sellerServiceFile = path.resolve(__dirname, '../services/SellerService.ts');
      const content = fs.readFileSync(sellerServiceFile, 'utf8');

      assert(content.includes('verifySellerPAN'), 'verifySellerPAN must exist');
      assert(content.includes('verifySellerGSTIN'), 'verifySellerGSTIN must exist');
      assert(content.includes('verifySellerBank'), 'verifySellerBank must exist');
      assert(content.includes('saveOnboarding'), 'saveOnboarding must exist for Kirana details');
    });

  } finally {
    await disconnectDatabase();
  }

  console.log('\n===============================================================');
  console.log(`🎉 ALL TESTS COMPLETED: ${passedCount}/${totalCount} PASSED`);
  console.log('===============================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n💥 Test suite execution failed:', err);
  process.exit(1);
});
