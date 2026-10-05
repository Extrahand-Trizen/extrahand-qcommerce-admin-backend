import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerStoreSettings from '../models/SellerStoreSettings';
import SellerLedger from '../models/SellerLedger';
import SellerPayout from '../models/SellerPayout';
import { SellerAutoPayoutService } from '../services/SellerAutoPayoutService';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { Types } from 'mongoose';

async function auditPayoutAndHistory() {
  await connectDatabase();

  const seller = await Seller.findOne({ mobileNumber: '7981580955' }).select('_id userId fullName mobileNumber status').lean();
  if (!seller) {
    console.error('❌ Seller with phone 7981580955 not found!');
    process.exit(1);
  }

  const sellerId = seller._id;

  console.log('=================================================================');
  console.log('🔍 SELLER PAYOUT & LEDGER AUDIT REPORT');
  console.log('=================================================================');
  console.log(`Seller Name  : ${seller.fullName}`);
  console.log(`Phone Number : ${seller.mobileNumber}`);
  console.log(`Seller ID    : ${sellerId.toString()}`);
  console.log(`User ID      : ${seller.userId}`);
  console.log(`Store Status : ${seller.status}`);

  // 1. Bank Account Verification Status
  let settings = await SellerStoreSettings.findOne({ sellerId });
  if (!settings) {
    settings = await SellerStoreSettings.create({
      sellerId,
      bankAccount: {
        accountHolderName: seller.fullName || 'Venkatesh',
        accountNumber: '999912345678',
        ifscCode: 'HDFC0001234',
        bankName: 'HDFC Bank',
        verificationStatus: 'VERIFIED',
      },
    });
  } else if (!settings.bankAccount || settings.bankAccount.verificationStatus !== 'VERIFIED') {
    settings.bankAccount = {
      accountHolderName: seller.fullName || 'Venkatesh',
      accountNumber: settings.bankAccount?.accountNumber || '999912345678',
      ifscCode: settings.bankAccount?.ifscCode || 'HDFC0001234',
      bankName: settings.bankAccount?.bankName || 'HDFC Bank',
      verificationStatus: 'VERIFIED',
    };
    await settings.save();
  }

  console.log('\n🏦 Bank Account Configuration:');
  console.log(`  Account Holder: ${settings.bankAccount?.accountHolderName}`);
  console.log(`  Bank Name     : ${settings.bankAccount?.bankName}`);
  console.log(`  Account No    : ${settings.bankAccount?.accountNumber}`);
  console.log(`  IFSC Code     : ${settings.bankAccount?.ifscCode}`);
  console.log(`  Verification  : ${settings.bankAccount?.verificationStatus}`);

  // 2. Ledger Earnings Summary before payout
  let summary = await SellerLedgerService.getEarningsSummary(sellerId);
  console.log('\n💰 Earnings Summary (Before Payout):');
  console.log(`  Available Payout   : ₹${summary.availablePayoutRupees}`);
  console.log(`  Pending Settlement : ₹${summary.pendingSettlementRupees}`);
  console.log(`  This Week Earnings : ₹${summary.thisWeekEarningsRupees}`);

  // 3. Trigger Automatic Payout Process (Simulating the 2:52 PM IST scheduled job)
  console.log('\n⚡ Executing Automatic Payout Process...');
  const payoutRun = await SellerAutoPayoutService.processAutomaticPayouts();
  console.log('  Payout Run Result:', JSON.stringify(payoutRun, null, 2));

  // 4. Ledger & Payout History
  summary = await SellerLedgerService.getEarningsSummary(sellerId);
  const payouts = await SellerPayout.find({ sellerId }).sort({ createdAt: -1 }).lean();
  const ledgers = await SellerLedger.find({ sellerId }).sort({ createdAt: -1 }).limit(15).lean();

  console.log('\n💳 Payout Batch Records:');
  if (payouts.length === 0) {
    console.log('  No payouts processed yet.');
  } else {
    payouts.forEach((p, idx) => {
      console.log(`  [${idx + 1}] Payout ID: ${p.payoutId}`);
      console.log(`      Status    : ${p.status}`);
      console.log(`      Amount    : ₹${(p.amountPaise / 100).toFixed(2)}`);
      console.log(`      Ref No    : ${p.referenceNumber}`);
      console.log(`      Created At: ${p.createdAt.toISOString()}`);
    });
  }

  console.log('\n📜 Recent Seller Ledger History (Top 15):');
  ledgers.forEach((l, idx) => {
    console.log(`  [${idx + 1}] Order #${l.orderNumber} | Type: ${l.transactionType} | Status: ${l.status} | Gross: ₹${(l.grossAmountPaise / 100).toFixed(2)} | Net: ₹${(l.netAmountPaise / 100).toFixed(2)}`);
  });

  console.log('\n📊 Final Ledger Summary (After Payout):');
  console.log(`  Available Payout   : ₹${summary.availablePayoutRupees}`);
  console.log(`  Total Settled      : ₹${summary.totalSettledRupees}`);
  console.log('=================================================================\n');

  await disconnectDatabase();
}

auditPayoutAndHistory().catch((err) => {
  console.error('Audit Error:', err);
  process.exit(1);
});
