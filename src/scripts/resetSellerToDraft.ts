import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerApprovalHistory from '../models/SellerApprovalHistory';

async function resetSeller(phone: string) {
  await connectDatabase();
  const seller = await Seller.findOne({ mobileNumber: phone });
  if (!seller) {
    console.log(`❌ No seller found with phone: ${phone}`);
    await disconnectDatabase();
    process.exit(1);
  }

  console.log(`Found seller: ${seller._id}, current onboardingStatus: ${seller.onboardingStatus}`);

  seller.status = 'PENDING';
  seller.onboardingStatus = 'DRAFT';
  await seller.save();

  const onboarding = await SellerOnboarding.findOne({ sellerId: seller._id });
  if (onboarding) {
    onboarding.status = 'DRAFT';
    onboarding.adminComment = undefined;
    onboarding.lastCorrectionNote = undefined;
    onboarding.submittedAt = undefined;
    onboarding.reviewedAt = undefined;
    onboarding.reviewedBy = undefined;
    await onboarding.save();
    console.log(`Onboarding record reset to DRAFT`);
  }

  // Clear previous approval history for a clean slate
  await SellerApprovalHistory.deleteMany({ sellerId: seller._id });
  console.log(`Cleared approval history for clean test`);

  console.log(`✅ Seller ${phone} successfully reset to DRAFT!`);
  await disconnectDatabase();
  process.exit(0);
}

const targetPhone = process.argv[2] || '7893396338';
resetSeller(targetPhone).catch(async (err) => {
  console.error(err);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
