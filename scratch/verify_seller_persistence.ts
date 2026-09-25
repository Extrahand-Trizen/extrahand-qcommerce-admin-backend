import mongoose from 'mongoose';
import SellerOnboarding from '../src/models/SellerOnboarding';
import { SellerService } from '../src/services/SellerService';

async function main() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri, { dbName: 'extrahand' });
  console.log('Connected to MongoDB');

  const onb = await SellerOnboarding.findOne({ shopName: 'Check-in' });
  if (!onb) {
    console.log('Check-in onboarding not found');
    await mongoose.disconnect();
    return;
  }

  console.log('Testing getSeller before mock backfill:');
  const initial = await SellerService.getSeller(String(onb.sellerId));
  console.log('  Initial Bank:', (initial.onboarding as any)?.bankAccount);
  console.log('  Initial Aadhaar:', (initial.onboarding as any)?.aadhaarNumber);

  // Let's set sample Aadhaar and Bank to simulate what happens when seller enters them
  onb.aadhaarNumber = '548962314589';
  onb.aadhaarVerificationStatus = 'VERIFIED';
  onb.aadhaarVerifiedAt = new Date();
  onb.bankAccount = {
    accountHolderName: 'Checkin Owner',
    accountNumber: '918241993001',
    ifscCode: 'SBIN0001234',
    bankName: 'State Bank of India',
    verificationStatus: 'VERIFIED',
  };
  await onb.save();

  console.log('Testing getSeller AFTER backfill:');
  const fetched = await SellerService.getSeller(String(onb.sellerId));
  console.log('  Aadhaar Number from getSeller:', (fetched.onboarding as any)?.aadhaarNumber);
  console.log('  Aadhaar Status from getSeller:', (fetched.onboarding as any)?.aadhaarVerificationStatus);
  console.log('  Bank Account from getSeller:', (fetched.onboarding as any)?.bankAccount);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
