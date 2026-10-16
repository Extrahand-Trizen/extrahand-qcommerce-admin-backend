/**
 * Utility script to attach or update a selfie photo for a seller's onboarding draft.
 * Useful when device camera/USB debugging is failing during testing.
 *
 * Usage:
 *   npx ts-node src/scripts/setSellerSelfie.ts <phone> [selfieUrl]
 *
 * Example:
 *   npx ts-node src/scripts/setSellerSelfie.ts 0000000000
 *   npx ts-node src/scripts/setSellerSelfie.ts 7893396338
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';
import { phoneVariants, phoneLast10 } from '../utils/phone';

const DEFAULT_SAMPLE_SELFIE =
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80';

async function main() {
  const phone = process.argv[2];
  const customUrl = process.argv[3];

  if (!phone) {
    console.error('Usage: npx ts-node src/scripts/setSellerSelfie.ts <phone> [selfieUrl]');
    process.exit(1);
  }

  const selfieUri = customUrl || DEFAULT_SAMPLE_SELFIE;

  await connectDatabase();

  const last10 = phoneLast10(phone);
  const variants = phoneVariants(phone);

  const sellers = await Seller.find({
    $or: [
      { mobileNumber: { $in: variants } },
      { mobileNumber: new RegExp(last10 + '$') },
      { userId: phone },
      { userId: `seller_${last10}` },
    ],
    status: { $ne: 'DELETED' },
  }).sort({ _id: -1 });

  if (!sellers.length) {
    console.error(`❌ No active seller found for phone ${phone}`);
    await disconnectDatabase();
    process.exit(1);
  }

  console.log(`Found ${sellers.length} active seller record(s) matching ${phone}:`);

  for (const seller of sellers) {
    console.log(`\nProcessing Seller _id: ${seller._id} (${seller.fullName || 'Seller'}, mobile: ${seller.mobileNumber}, userId: ${seller.userId})`);

    // 1. Update or create onboarding
    let onboarding = await SellerOnboarding.findOne({ sellerId: seller._id });
    if (!onboarding) {
      console.log('  No onboarding record found, creating one...');
      onboarding = new SellerOnboarding({
        sellerId: seller._id,
        mobileNumber: seller.mobileNumber,
        fullName: seller.fullName || 'Seller',
        status: 'DRAFT',
        kycSelfieUri: selfieUri,
      });
      await onboarding.save();
    } else {
      onboarding.kycSelfieUri = selfieUri;
      await onboarding.save();
    }
    console.log(`  ✅ Updated SellerOnboarding (_id: ${onboarding._id}) with kycSelfieUri: ${selfieUri}`);

    // 2. Upsert SellerDocument with documentType: 'SELFIE'
    const docResult = await SellerDocument.findOneAndUpdate(
      { sellerId: seller._id, documentType: 'SELFIE' },
      {
        sellerId: seller._id,
        documentType: 'SELFIE',
        fileName: 'Live Selfie',
        fileUrl: selfieUri,
        mimeType: 'image/jpeg',
        verificationStatus: 'VERIFIED',
        uploadedAt: new Date(),
      },
      { upsert: true, new: true }
    );
    console.log(`  ✅ Upserted SellerDocument (_id: ${docResult._id}) for SELFIE as VERIFIED`);
  }

  console.log(`\n🎉 All done! When the seller opens or refreshes the Seller App or Helper App,`);
  console.log(`   the live selfie will appear as captured / completed!`);

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('Error updating selfie:', err);
  await disconnectDatabase();
  process.exit(1);
});
