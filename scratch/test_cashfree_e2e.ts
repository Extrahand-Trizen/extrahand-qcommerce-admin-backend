import mongoose from 'mongoose';
import { signAccessToken } from '../src/utils/jwt';
import Seller from '../src/models/Seller';
import SellerOnboarding from '../src/models/SellerOnboarding';

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });
  console.log('✅ Connected to MongoDB');

  // Find or create a draft seller
  let seller = await Seller.findOne({ mobileNumber: '9999988888' });
  if (!seller) {
    seller = await Seller.create({
      userId: 'test_onboarding_uid_99999',
      fullName: 'Test Onboarding Seller',
      mobileNumber: '9999988888',
      email: 'onboarding_test@example.com',
      status: 'PENDING',
      onboardingStatus: 'DRAFT',
    });
  }

  let onb = await SellerOnboarding.findOne({ sellerId: seller._id });
  if (onb) {
    onb.status = 'DRAFT';
    await onb.save();
  }

  const token = signAccessToken({
    sub: seller.userId,
    role: 'SELLER',
    sellerId: seller._id.toString(),
  });

  const baseUrl = 'http://127.0.0.1:4010/api/v1';

  console.log('\n--- 1. Testing Cashfree Aadhaar Verification ---');
  // 1a. Invalid Aadhaar (fake number rejected by Cashfree UIDAI check)
  const resBadAadhaar = await fetch(`${baseUrl}/sellers/onboarding/verify-aadhaar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ aadhaarNumber: '548962314589' }),
  });
  const dataBadAadhaar = await resBadAadhaar.json();
  console.log('1a. Fake Aadhaar response (Expected 400 Invalid Aadhaar Card):', resBadAadhaar.status, dataBadAadhaar);

  console.log('\n--- 2. Testing Cashfree Bank Verification ---');
  // 2a. Invalid Bank Account (fake account rejected by Cashfree IMPS check)
  const resBadBank = await fetch(`${baseUrl}/sellers/onboarding/verify-bank`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      accountNumber: '918241993001',
      ifscCode: 'SBIN0001234',
      accountHolderName: 'Fake Account Owner',
    }),
  });
  const dataBadBank = await resBadBank.json();
  console.log('2a. Fake Bank Account response (Expected 400 Invalid Account):', resBadBank.status, dataBadBank);

  // 2b. Valid Bank Account (verified via Cashfree)
  const resValidBank = await fetch(`${baseUrl}/sellers/onboarding/verify-bank`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      accountNumber: '026291800001191',
      ifscCode: 'YESB0000262',
      accountHolderName: 'AMEYA ANIL KHANWALKAR',
    }),
  });
  const dataValidBank = await resValidBank.json();
  console.log('2b. Valid Bank Account response (Expected 200 via Cashfree):', resValidBank.status, dataValidBank);

  console.log('\n--- 3. Verifying Database State ---');
  onb = await SellerOnboarding.findOne({ sellerId: seller._id });
  console.log('Database Bank Account:', onb?.bankAccount);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error running test:', err);
  process.exit(1);
});
