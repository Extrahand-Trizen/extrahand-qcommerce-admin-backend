import mongoose, { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerStoreSettings from '../models/SellerStoreSettings';
import CustomerOrder from '../models/CustomerOrder';
import SellerLedger from '../models/SellerLedger';
import SellerPayout from '../models/SellerPayout';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { SellerSettlementService } from '../services/SellerSettlementService';
import { SellerPayoutService } from '../services/SellerPayoutService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ PASS: ${message}`);
}

async function run() {
  console.log('\n======================================================');
  console.log('Testing Seller Payment, Settlement & Payout Lifecycle');
  console.log('======================================================\n');

  await connectDatabase();

  const ts = Date.now();
  const sellerIdA = new Types.ObjectId();
  const sellerIdB = new Types.ObjectId();

  // Create Seller A with verified bank account
  await Seller.create({
    _id: sellerIdA,
    userId: `seller-user-a-${ts}`,
    fullName: `Seller A ${ts}`,
    mobileNumber: `9${String(ts).slice(-9)}`,
    status: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  });

  await SellerStoreSettings.create({
    sellerId: sellerIdA,
    storeStatus: 'OPEN',
    statusMode: 'MANUAL',
    openTime: '08:00',
    closeTime: '22:00',
    daysOpen: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    bankAccount: {
      accountHolderName: 'Seller A Trading',
      accountNumber: '123456789012',
      ifscCode: 'HDFC0001234',
      bankName: 'HDFC Bank',
      verificationStatus: 'VERIFIED',
    },
  });

  // Create Seller B (for multi-shop isolation testing)
  await Seller.create({
    _id: sellerIdB,
    userId: `seller-user-b-${ts}`,
    fullName: `Seller B ${ts}`,
    mobileNumber: `8${String(ts).slice(-9)}`,
    status: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  });

  await SellerStoreSettings.create({
    sellerId: sellerIdB,
    storeStatus: 'OPEN',
    statusMode: 'MANUAL',
    openTime: '08:00',
    closeTime: '22:00',
    daysOpen: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  });

  console.log('Setup: Created Seller A and Seller B with isolated store contexts.\n');

  // --------------------------------------------------------------------------
  // STEP 1: Customer Pays -> Payment Recorded Immediately as PENDING_ORDER_COMPLETION
  // --------------------------------------------------------------------------
  console.log('--- STEP 1: Customer places order & pays (₹1,000 gross product total) ---');

  const orderA = await CustomerOrder.create({
    orderNumber: `ORD-TEST-${ts}`,
    sellerId: sellerIdA,
    userId: `customer-${ts}`,
    itemTotalPaise: 100000, // ₹1,000 product total
    deliveryFeePaise: 5000, // ₹50 delivery fee
    handlingFeePaise: 0,
    partnerTipPaise: 0,
    couponDiscountPaise: 0,
    amountPaise: 105000, // ₹1,050 total customer payment
    paymentStatus: 'PAID',
    status: 'PAID',
    fulfillmentStatus: 'PENDING_ACCEPT',
    items: [
      {
        name: 'Test Product',
        productSlug: `test-prod-${ts}`,
        masterProductId: new Types.ObjectId(),
        unit: '1 kg',
        unitPricePaise: 100000,
        quantity: 1,
        lineTotalPaise: 100000,
      },
    ],
    address: { line1: '123 Test St', city: 'Bangalore', state: 'Karnataka', pinCode: '560001' },
    razorpayOrderId: `order_rzp_${ts}`,
    razorpayPaymentId: `pay_rzp_${ts}`,
    fulfillmentEvents: [],
    refunds: [],
    deliveryInstructions: [],
  });

  const ledgerEntry1 = await SellerLedgerService.recordCustomerPayment(orderA);
  assert(ledgerEntry1.status === 'PENDING_ORDER_COMPLETION', 'Ledger recorded as PENDING_ORDER_COMPLETION at payment time');
  assert(ledgerEntry1.grossAmountPaise === 100000, 'Gross amount is ₹1,000 (100,000 paise)');
  assert(ledgerEntry1.commissionAmountPaise === 5000, 'Commission is 5% = ₹50 (5,000 paise)');
  assert(ledgerEntry1.taxOnCommissionPaise === 900, 'GST on commission is 18% = ₹9 (900 paise)');
  assert(ledgerEntry1.netAmountPaise === 94100, 'Seller net earning is ₹941 (94,100 paise)');

  // Verify Seller App summary at this stage
  let summaryA = await SellerLedgerService.getEarningsSummary(sellerIdA);
  assert(summaryA.availablePayoutPaise === 0, 'Available payout is ₹0 before completion/settlement');
  assert(summaryA.pendingSettlementPaise === 0, 'Pending settlement is ₹0 until order is completed');

  // Verify payment is visible in transaction log
  const txnsAfterPayment = await SellerLedgerService.listTransactions(sellerIdA);
  assert(txnsAfterPayment.total === 1, 'Payment is immediately visible in transaction history');
  assert(txnsAfterPayment.items[0].status === 'PENDING_ORDER_COMPLETION', 'Status shows PENDING_ORDER_COMPLETION');

  // --------------------------------------------------------------------------
  // STEP 2: Order Delivered/Completed -> PENDING_SETTLEMENT with 48h Timer
  // --------------------------------------------------------------------------
  console.log('\n--- STEP 2: Delivery Partner marks order COMPLETED ---');

  const completedAt = new Date();
  orderA.fulfillmentStatus = 'COMPLETED';
  orderA.status = 'DELIVERED';
  orderA.completedAt = completedAt;
  await orderA.save();

  const ledgerAfterCompletion = await SellerLedgerService.recordOrderCompletion(orderA);
  assert(ledgerAfterCompletion.status === 'PENDING_SETTLEMENT', 'Ledger promoted to PENDING_SETTLEMENT');
  assert(Boolean(ledgerAfterCompletion.settlementEligibleAt), 'settlementEligibleAt timestamp stamped');

  const expectedEligibleMs = completedAt.getTime() + 48 * 3600 * 1000;
  const actualEligibleMs = ledgerAfterCompletion.settlementEligibleAt!.getTime();
  assert(Math.abs(expectedEligibleMs - actualEligibleMs) < 2000, 'settlementEligibleAt is exactly completedAt + 48 hours');

  summaryA = await SellerLedgerService.getEarningsSummary(sellerIdA);
  assert(summaryA.pendingSettlementPaise === 94100, 'Pending Settlement is now ₹941 (94,100 paise)');
  assert(summaryA.availablePayoutPaise === 0, 'Available Payout remains ₹0 during 48h waiting period');
  assert(summaryA.todayEarningsPaise === 94100, "Today's Earnings includes the completed order (₹941)");

  const pendingList = await SellerLedgerService.getPendingSettlements(sellerIdA);
  assert(pendingList.length === 1, 'Order visible in pending settlements list');
  assert(pendingList[0].sellerEarningsPaise === 94100, 'Pending item has correct net earning');
  assert(Boolean(pendingList[0].settlementEligibleAt), 'Pending item displays exact eligible date/time');

  // --------------------------------------------------------------------------
  // STEP 3: Premature Settlement Sweep (Before 48h elapses)
  // --------------------------------------------------------------------------
  console.log('\n--- STEP 3: Background sweeper runs before 48h expires ---');

  let maturedCount = await SellerSettlementService.processMaturedSettlements();
  assert(maturedCount === 0, 'Sweeper does NOT advance settlement prematurely');

  const ledgerCheck = await SellerLedger.findById(ledgerAfterCompletion._id).lean();
  assert(ledgerCheck?.status === 'PENDING_SETTLEMENT', 'Ledger status remains PENDING_SETTLEMENT');

  // --------------------------------------------------------------------------
  // STEP 4: 48h Settlement Window Matures -> Status becomes AVAILABLE
  // --------------------------------------------------------------------------
  console.log('\n--- STEP 4: 48h passes -> Settlement Matures to AVAILABLE ---');

  // Fast-forward: backdate settlementEligibleAt to 10 minutes ago
  await SellerLedger.findByIdAndUpdate(ledgerAfterCompletion._id, {
    settlementEligibleAt: new Date(Date.now() - 10 * 60 * 1000),
  });

  maturedCount = await SellerSettlementService.processMaturedSettlements();
  assert(maturedCount >= 1, `Sweeper matured ${maturedCount} settlement(s)`);

  const ledgerMatured = await SellerLedger.findById(ledgerAfterCompletion._id).lean();
  assert(ledgerMatured?.status === 'AVAILABLE', 'Ledger status automatically advanced to AVAILABLE');

  summaryA = await SellerLedgerService.getEarningsSummary(sellerIdA);
  assert(summaryA.pendingSettlementPaise === 0, 'Pending Settlement is now ₹0');
  assert(summaryA.availablePayoutPaise === 94100, 'Available Payout is now ₹941 (ready for withdrawal)');

  const availableData = await SellerLedgerService.getAvailablePayouts(sellerIdA);
  assert(availableData.totalAvailablePaise === 94100, 'Available payouts API returns ₹941');
  assert(availableData.items.length === 1, 'Item listed in available payouts');

  // --------------------------------------------------------------------------
  // STEP 5: Seller Initiates Payout -> Status becomes PAYOUT_PROCESSING
  // --------------------------------------------------------------------------
  console.log('\n--- STEP 5: Seller requests payout of available funds ---');

  const payout = await SellerPayoutService.requestPayout(sellerIdA, 94100);
  assert(payout.status === 'PROCESSING', 'Payout created with status PROCESSING');
  assert(payout.amountPaise === 94100, 'Payout amount is ₹941');
  assert(payout.bankAccount.accountNumberMasked === '•••• 9012', 'Bank account correctly masked in payout');

  // Ledger entries must be marked PAYOUT_PROCESSING
  const ledgerInPayout = await SellerLedger.findById(ledgerAfterCompletion._id).lean();
  assert(ledgerInPayout?.status === 'PAYOUT_PROCESSING', 'Ledger entry marked PAYOUT_PROCESSING');
  assert(ledgerInPayout?.payoutId === payout.payoutId, 'Ledger entry linked to payoutId');

  summaryA = await SellerLedgerService.getEarningsSummary(sellerIdA);
  assert(summaryA.availablePayoutPaise === 0, 'Available Payout is 0 while payout is processing');

  // --------------------------------------------------------------------------
  // STEP 6: Gateway Confirms Payout -> SETTLED
  // --------------------------------------------------------------------------
  console.log('\n--- STEP 6: Payout gateway confirms success -> SETTLED ---');

  await SellerPayoutService.finalizePayout(payout.payoutId, true, 'UTR_123456789');

  const payoutSettled = await SellerPayout.findOne({ payoutId: payout.payoutId }).lean();
  assert(payoutSettled?.status === 'SETTLED', 'Payout marked SETTLED');
  assert(Boolean(payoutSettled?.settledAt), 'Payout settledAt stamped');

  const ledgerSettled = await SellerLedger.findById(ledgerAfterCompletion._id).lean();
  assert(ledgerSettled?.status === 'SETTLED', 'Ledger entry marked SETTLED');

  summaryA = await SellerLedgerService.getEarningsSummary(sellerIdA);
  assert(summaryA.totalSettledPaise === 94100, 'Total Settled is now ₹941');

  // --------------------------------------------------------------------------
  // STEP 7: Payout Failure Edge Case -> Safe Rollback to AVAILABLE
  // --------------------------------------------------------------------------
  console.log('\n--- STEP 7: Payout failure edge case -> funds returned to AVAILABLE ---');

  // Create a second earning that is available
  const orderFailTest = await CustomerOrder.create({
    orderNumber: `ORD-FAIL-${ts}`,
    sellerId: sellerIdA,
    userId: `customer-${ts}`,
    itemTotalPaise: 60000, // ₹600
    deliveryFeePaise: 0,
    handlingFeePaise: 0,
    partnerTipPaise: 0,
    couponDiscountPaise: 0,
    amountPaise: 60000,
    paymentStatus: 'PAID',
    status: 'DELIVERED',
    fulfillmentStatus: 'COMPLETED',
    items: [
      {
        name: 'Test Product 2',
        productSlug: `test-prod-2-${ts}`,
        masterProductId: new Types.ObjectId(),
        unit: '1 kg',
        unitPricePaise: 60000,
        quantity: 1,
        lineTotalPaise: 60000,
      },
    ],
    address: { line1: '123 Test St', city: 'Bangalore', state: 'Karnataka', pinCode: '560001' },
  });

  const failLedger = await SellerLedger.create({
    sellerId: sellerIdA,
    orderId: orderFailTest._id,
    orderNumber: orderFailTest.orderNumber,
    transactionType: 'ORDER_EARNING',
    grossAmountPaise: 60000,
    commissionAmountPaise: 3000,
    taxOnCommissionPaise: 540,
    netAmountPaise: 56460, // ₹564.60
    status: 'AVAILABLE',
  });

  // Request payout
  const failedPayout = await SellerPayoutService.requestPayout(sellerIdA, 56460);
  assert(failedPayout.status === 'PROCESSING', 'Payout created for fail test');

  // Simulate gateway failure
  await SellerPayoutService.finalizePayout(
    failedPayout.payoutId,
    false,
    undefined,
    'Beneficiary bank account inactive',
  );

  const updatedFailedPayout = await SellerPayout.findOne({ payoutId: failedPayout.payoutId }).lean();
  assert(updatedFailedPayout?.status === 'FAILED', 'Payout marked FAILED');
  assert(updatedFailedPayout?.failureReason === 'Beneficiary bank account inactive', 'Failure reason captured');

  // CRITICAL: Ledger entry MUST be restored to AVAILABLE so seller loses zero money!
  const rolledBackLedger = await SellerLedger.findById(failLedger._id).lean();
  assert(rolledBackLedger?.status === 'AVAILABLE', 'Ledger entry safely restored to AVAILABLE after payout failure');
  assert(!rolledBackLedger?.payoutId, 'PayoutId unlinked from ledger entry');

  // --------------------------------------------------------------------------
  // STEP 8: Multi-Shop Financial Isolation Testing
  // --------------------------------------------------------------------------
  console.log('\n--- STEP 8: Multi-shop financial isolation verification ---');

  // Seller B summary must be completely empty/zero
  const summaryB = await SellerLedgerService.getEarningsSummary(sellerIdB);
  assert(summaryB.todayEarningsPaise === 0, "Seller B today's earnings is 0");
  assert(summaryB.pendingSettlementPaise === 0, 'Seller B pending settlement is 0');
  assert(summaryB.availablePayoutPaise === 0, 'Seller B available payout is 0');
  assert(summaryB.totalSettledPaise === 0, 'Seller B total settled is 0');

  // Seller B payout list must not contain Seller A's payouts
  const payoutsB = await SellerPayoutService.listPayouts(sellerIdB);
  assert(payoutsB.total === 0, "Seller B cannot see Seller A's payouts");

  // Seller B cannot request payout without bank account
  let sellerBBlocked = false;
  try {
    await SellerPayoutService.requestPayout(sellerIdB, 50000);
  } catch (err: any) {
    sellerBBlocked = true;
    assert(err.statusCode === 400, 'Seller B blocked from payout without configured bank account');
  }
  assert(sellerBBlocked, 'Multi-shop bank account protection enforced');

  // --------------------------------------------------------------------------
  // Clean up test records
  // --------------------------------------------------------------------------
  console.log('\n--- Cleaning up test records ---');
  await SellerLedger.deleteMany({ sellerId: { $in: [sellerIdA, sellerIdB] } });
  await SellerPayout.deleteMany({ sellerId: { $in: [sellerIdA, sellerIdB] } });
  await CustomerOrder.deleteMany({ _id: { $in: [orderA._id, orderFailTest._id] } });
  await SellerStoreSettings.deleteMany({ sellerId: { $in: [sellerIdA, sellerIdB] } });
  await Seller.deleteMany({ _id: { $in: [sellerIdA, sellerIdB] } });

  console.log('\n======================================================');
  console.log('All Seller Payment & Settlement Tests PASSED! 🎉');
  console.log('======================================================\n');

  await disconnectDatabase();
}

run().catch(async (err) => {
  console.error('Test execution failed:', err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
