import mongoose, { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerStoreSettings from '../models/SellerStoreSettings';
import CustomerOrder from '../models/CustomerOrder';
import SellerLedger from '../models/SellerLedger';
import SellerPayout from '../models/SellerPayout';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { SellerSettlementService } from '../services/SellerSettlementService';
import { SellerAutoPayoutService } from '../services/SellerAutoPayoutService';
import { SellerPayoutService } from '../services/SellerPayoutService';
import { setPayoutProviderForTest, MockPayoutProvider } from '../services/payout/PayoutProvider';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runTests() {
  console.log('--- Starting ExtraHand Auto-Payout & T+2 Workflow Verification ---');
  await connectDatabase();

  const testSellerId = new Types.ObjectId();
  const testUserId = `user_test_${Date.now()}`;
  const testOrderNumber = `ORD-TEST-${Date.now()}`;

  // Clean up before starting
  await Seller.deleteMany({ _id: testSellerId });
  await SellerStoreSettings.deleteMany({ sellerId: testSellerId });
  await CustomerOrder.deleteMany({ orderNumber: testOrderNumber });
  await SellerLedger.deleteMany({ sellerId: testSellerId });
  await SellerPayout.deleteMany({ sellerId: testSellerId });

  // Use MockPayoutProvider for tests
  setPayoutProviderForTest(new MockPayoutProvider());

  try {
    // 1. Setup Seller
    await Seller.create({
      _id: testSellerId,
      userId: testUserId,
      fullName: 'Test Merchant AutoPayout',
      mobileNumber: '9876543210',
      status: 'ACTIVE',
      onboardingStatus: 'APPROVED',
    });

    // 2. Setup Seller Store Settings with UNVERIFIED (PENDING) Bank Account
    await SellerStoreSettings.create({
      sellerId: testSellerId,
      storeStatus: 'OPEN',
      bankAccount: {
        accountHolderName: 'Test Merchant',
        accountNumber: '123456789012',
        ifscCode: 'HDFC0001234',
        bankName: 'HDFC Bank',
        passbookImageUrl: 'https://example.com/passbook.jpg',
        verificationStatus: 'PENDING',
      },
    });

    // 3. Create a Completed Order
    const completedAt = new Date();
    const order = await CustomerOrder.create({
      userId: testUserId,
      sellerId: testSellerId,
      orderNumber: testOrderNumber,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'COMPLETED',
      completedAt,
      amountPaise: 100000, // ₹1,000
      itemTotalPaise: 100000,
      deliveryFeePaise: 0,
      handlingFeePaise: 0,
      address: { line1: 'Test Address', city: 'Bengaluru', pinCode: '560001' },
    });

    console.log('\n--- Step 1: Order Completion & 48-Hour Settlement Stamping ---');
    const ledgerEntry = await SellerLedgerService.recordOrderCompletion(order);
    assert(ledgerEntry.status === 'PENDING_SETTLEMENT', 'Ledger is in PENDING_SETTLEMENT');
    assert(Boolean(ledgerEntry.completedAt), 'completedAt timestamp is stamped');
    assert(Boolean(ledgerEntry.settlementEligibleAt), 'settlementEligibleAt is stamped');

    const expectedEligibleTime = completedAt.getTime() + 48 * 3600 * 1000;
    const actualEligibleTime = ledgerEntry.settlementEligibleAt!.getTime();
    assert(
      Math.abs(expectedEligibleTime - actualEligibleTime) < 5000,
      'settlementEligibleAt is exactly completedAt + 48 hours',
    );

    console.log('\n--- Step 2: Settlement Maturation Sweeper ---');
    // Fast forward settlementEligibleAt to the past (matured)
    await SellerLedger.updateOne(
      { _id: ledgerEntry._id },
      { $set: { settlementEligibleAt: new Date(Date.now() - 5 * 60 * 1000) } },
    );

    const maturedCount = await SellerSettlementService.processMaturedSettlements();
    assert(maturedCount >= 1, 'Matured entries advanced to AVAILABLE');

    const maturedEntry = await SellerLedger.findById(ledgerEntry._id).lean();
    assert(maturedEntry?.status === 'AVAILABLE', 'Ledger status is now AVAILABLE');

    console.log('\n--- Step 3: Bank Account Gating (Unverified Bank Account) ---');
    // Run auto payout worker while bank verificationStatus is PENDING
    const unverifiedRunResult = await SellerAutoPayoutService.processAutomaticPayouts();
    assert(
      unverifiedRunResult.initiatedPayoutsCount === 0,
      'Auto-payout did NOT initiate payout for unverified bank account',
    );

    const ledgerStillAvailable = await SellerLedger.findById(ledgerEntry._id).lean();
    assert(
      ledgerStillAvailable?.status === 'AVAILABLE',
      'Ledger entry remains safely in AVAILABLE status without data loss',
    );
    assert(
      unverifiedRunResult.skippedSellers.some((s) => s.sellerId === testSellerId.toString()),
      'Worker logged skip reason for unverified bank account',
    );

    console.log('\n--- Step 4: Bank Account Gating (Rejected Bank Account) ---');
    await SellerStoreSettings.updateOne(
      { sellerId: testSellerId },
      { $set: { 'bankAccount.verificationStatus': 'REJECTED' } },
    );

    const rejectedRunResult = await SellerAutoPayoutService.processAutomaticPayouts();
    assert(rejectedRunResult.initiatedPayoutsCount === 0, 'Auto-payout skipped REJECTED bank account');
    const ledgerStillAvailable2 = await SellerLedger.findById(ledgerEntry._id).lean();
    assert(ledgerStillAvailable2?.status === 'AVAILABLE', 'Ledger entry remains in AVAILABLE status');

    console.log('\n--- Step 5: Bank Verification Completed → Auto-Payout Initiated ---');
    // Seller completes bank account verification
    await SellerStoreSettings.updateOne(
      { sellerId: testSellerId },
      {
        $set: {
          'bankAccount.verificationStatus': 'VERIFIED',
          'bankAccount.verifiedAt': new Date(),
          'bankAccount.bankVerifiedName': 'Test Merchant Official',
        },
      },
    );

    const verifiedRunResult = await SellerAutoPayoutService.processAutomaticPayouts();
    assert(verifiedRunResult.initiatedPayoutsCount === 1, 'Auto-payout successfully initiated 1 payout');
    assert(verifiedRunResult.totalDisbursedPaise === 94100, 'Exact net earnings disbursed (₹941 = ₹1000 - 5% - 18% GST)');

    const payoutRecord = await SellerPayout.findOne({ sellerId: testSellerId });
    assert(Boolean(payoutRecord), 'SellerPayout record exists in database');
    assert(payoutRecord?.amountPaise === 94100, 'SellerPayout amount matches net earnings');
    assert(payoutRecord?.status === 'PROCESSING', 'SellerPayout status is PROCESSING');
    assert(payoutRecord?.bankAccount.accountNumberMasked === '•••• 9012', 'Bank account is properly masked');

    const claimedLedger = await SellerLedger.findById(ledgerEntry._id).lean();
    assert(claimedLedger?.status === 'PAYOUT_PROCESSING', 'Ledger status transitioned to PAYOUT_PROCESSING');
    assert(claimedLedger?.payoutId === payoutRecord?.payoutId, 'Ledger linked to payoutId');

    console.log('\n--- Step 6: Idempotency & Duplicate Run Protection ---');
    // Run auto-payout worker again immediately
    const duplicateRunResult = await SellerAutoPayoutService.processAutomaticPayouts();
    assert(
      duplicateRunResult.initiatedPayoutsCount === 0,
      'Duplicate auto-payout run did not create duplicate payouts',
    );

    const totalPayouts = await SellerPayout.countDocuments({ sellerId: testSellerId });
    assert(totalPayouts === 1, 'Exactly one SellerPayout record exists (no duplicate payouts)');

    console.log('\n--- Step 7: Webhook Provider Confirmation (SETTLED) ---');
    await SellerPayoutService.finalizePayout(payoutRecord!.payoutId, true, 'UTR_TEST_REF_12345');

    const settledPayout = await SellerPayout.findOne({ payoutId: payoutRecord!.payoutId }).lean();
    assert(settledPayout?.status === 'SETTLED', 'SellerPayout status is SETTLED');
    assert(settledPayout?.gatewayPayoutId === 'UTR_TEST_REF_12345', 'Gateway reference stored');

    const settledLedger = await SellerLedger.findById(ledgerEntry._id).lean();
    assert(settledLedger?.status === 'SETTLED', 'SellerLedger status transitioned to SETTLED');
    assert(Boolean(settledLedger?.settledAt), 'settledAt timestamp recorded on ledger');

    console.log('\n--- Step 8: Provider Failure & Fund Reversion Safety Net ---');
    // Create another order and payout to test failure reversion
    const order2 = await CustomerOrder.create({
      userId: testUserId,
      sellerId: testSellerId,
      orderNumber: `${testOrderNumber}-2`,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'COMPLETED',
      completedAt: new Date(),
      amountPaise: 80000,
      itemTotalPaise: 80000,
      deliveryFeePaise: 0,
      handlingFeePaise: 0,
      address: { line1: 'Test Address', city: 'Bengaluru', pinCode: '560001' },
    });

    const ledger2 = await SellerLedgerService.recordOrderCompletion(order2);
    // Fast-forward to matured
    await SellerLedger.updateOne(
      { _id: ledger2._id },
      { $set: { settlementEligibleAt: new Date(Date.now() - 60000) } },
    );
    await SellerSettlementService.processMaturedSettlements();

    const run2 = await SellerAutoPayoutService.processAutomaticPayouts();
    assert(run2.initiatedPayoutsCount === 1, 'Initiated payout for second order');

    const payout2 = await SellerPayout.findOne({ amountPaise: 75280 });
    assert(Boolean(payout2), 'Second payout created');

    // Simulate provider failure webhook
    await SellerPayoutService.finalizePayout(
      payout2!.payoutId,
      false,
      undefined,
      'Bank server offline / invalid beneficiary',
    );

    const failedPayout = await SellerPayout.findOne({ payoutId: payout2!.payoutId }).lean();
    assert(failedPayout?.status === 'FAILED', 'SellerPayout marked FAILED');

    const restoredLedger = await SellerLedger.findById(ledger2._id).lean();
    assert(restoredLedger?.status === 'AVAILABLE', 'Failed payout ledger safely returned to AVAILABLE status');
    assert(!restoredLedger?.payoutId, 'payoutId was cleared from restored ledger entry');

    console.log('\n🎉 ALL 8 TEST PHASES PASSED SUCCESSFULLY! 🎉');
  } finally {
    // Clean up test data
    await Seller.deleteMany({ _id: testSellerId });
    await SellerStoreSettings.deleteMany({ sellerId: testSellerId });
    await CustomerOrder.deleteMany({ orderNumber: { $regex: `^ORD-TEST-` } });
    await SellerLedger.deleteMany({ sellerId: testSellerId });
    await SellerPayout.deleteMany({ sellerId: testSellerId });
    await disconnectDatabase();
  }
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
