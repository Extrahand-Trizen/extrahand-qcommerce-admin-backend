import mongoose from 'mongoose';
import { signAccessToken } from '../src/utils/jwt';
import Seller from '../src/models/Seller';
import SellerOnboarding from '../src/models/SellerOnboarding';
import SellerStoreSettings from '../src/models/SellerStoreSettings';

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });
  console.log('✅ Connected to MongoDB');

  // Find or create a draft test seller
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

  // Ensure onboarding is in DRAFT
  let onb = await SellerOnboarding.findOne({ sellerId: seller._id });
  if (!onb) {
    onb = await SellerOnboarding.create({
      sellerId: seller._id,
      fullName: 'Test Onboarding Seller',
      mobileNumber: '9999988888',
      shopName: 'Test Fresh Mart',
      status: 'DRAFT',
      address: '123 Test St',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500001',
    });
  } else {
    onb.status = 'DRAFT';
    await onb.save();
  }

  console.log('Testing with draft seller:', seller._id.toString(), 'Phone:', seller.mobileNumber);

  // Mint an authentication token
  const token = signAccessToken({
    sub: seller.userId,
    role: 'SELLER',
    sellerId: seller._id.toString(),
  });

  const baseUrl = 'http://127.0.0.1:4010/api/v1';

  console.log('\n--- 1. Testing Aadhaar Verification by ONLY number ---');
  // 1a. Test invalid Aadhaar
  const resInvalid = await fetch(`${baseUrl}/sellers/onboarding/verify-aadhaar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ aadhaarNumber: '111111111111' }),
  });
  const dataInvalid = await resInvalid.json();
  console.log('1a. Invalid Aadhaar response (Expected 400):', resInvalid.status, dataInvalid);

  // 1b. Test valid Aadhaar (only number)
  const testAadhaar = '548962314589';
  const resValidAadhaar = await fetch(`${baseUrl}/sellers/onboarding/verify-aadhaar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ aadhaarNumber: testAadhaar }),
  });
  const dataValidAadhaar = await resValidAadhaar.json();
  console.log('1b. Valid Aadhaar response (Expected 200):', resValidAadhaar.status, dataValidAadhaar);

  console.log('\n--- 2. Testing Bank Verification by IFSC and Account Number ---');
  // 2a. Test invalid IFSC
  const resInvalidBank = await fetch(`${baseUrl}/sellers/onboarding/verify-bank`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      accountNumber: '1234567890',
      ifscCode: 'INVALID',
    }),
  });
  const dataInvalidBank = await resInvalidBank.json();
  console.log('2a. Invalid Bank IFSC response (Expected 400):', resInvalidBank.status, dataInvalidBank);

  // 2b. Test valid Bank account and IFSC (SBI)
  const testAccount = '918241993001';
  const testIfsc = 'SBIN0001234';
  const resValidBank = await fetch(`${baseUrl}/sellers/onboarding/verify-bank`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      accountNumber: testAccount,
      ifscCode: testIfsc,
      accountHolderName: 'Test Seller Owner',
    }),
  });
  const dataValidBank = await resValidBank.json();
  console.log('2b. Valid Bank response (Expected 200):', resValidBank.status, dataValidBank);

  console.log('\n--- 3. Verifying Database State ---');
  onb = await SellerOnboarding.findOne({ sellerId: seller._id });
  console.log('Onboarding Aadhaar Number:', onb?.aadhaarNumber);
  console.log('Onboarding Aadhaar Status:', onb?.aadhaarVerificationStatus);
  console.log('Onboarding Aadhaar Verified At:', onb?.aadhaarVerifiedAt);
  console.log('Onboarding Bank Account:', onb?.bankAccount);

  const settings = await SellerStoreSettings.findOne({ sellerId: seller._id });
  console.log('Store Settings Bank Account:', settings?.bankAccount);

  console.log('\n--- 4. Checking Admin Seller Details Endpoint ---');
  const resAdminSeller = await fetch(`${baseUrl}/sellers/${seller._id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signAccessToken({ sub: 'admin_test', role: 'SUPER_ADMIN' })}`,
    },
  });
  const dataAdminSeller = await resAdminSeller.json();
  console.log('Admin getSeller status:', resAdminSeller.status);
  console.log('Admin view Aadhaar:', dataAdminSeller.data?.onboarding?.aadhaarNumber, dataAdminSeller.data?.onboarding?.aadhaarVerificationStatus);
  console.log('Admin view Bank:', dataAdminSeller.data?.onboarding?.bankAccount);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error running test:', err);
  process.exit(1);
});
