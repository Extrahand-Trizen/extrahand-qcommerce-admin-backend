import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';

async function run() {
  await connectDatabase();
  for (const phone of ['0000000000', '7893396338']) {
    console.log(`\n================ Checking Phone: ${phone} ================`);
    const sellers = await Seller.find({
      $or: [{ mobileNumber: phone }, { mobileNumber: `+91${phone}` }, { mobileNumber: new RegExp(phone + '$') }],
    }).lean();

    console.log(`Found ${sellers.length} seller records:`);
    for (const s of sellers) {
      console.log(`  Seller _id: ${s._id}, mobile: "${s.mobileNumber}", status: ${s.status}, userId: ${s.userId}, name: ${s.fullName}, created: ${s.createdAt}`);
      const onboarding = await SellerOnboarding.findOne({ sellerId: s._id }).lean();
      if (onboarding) {
        console.log(`    Onboarding _id: ${onboarding._id}: status=${onboarding.status}, kycSelfieUri=${onboarding.kycSelfieUri}`);
        console.log(`    AadhaarStatus=${onboarding.aadhaarVerificationStatus}, panStatus=${onboarding.panVerificationStatus}`);
        console.log(`    panCardUrl=${(onboarding as any).panCardUrl || (onboarding as any).panDocumentUri || (onboarding as any).panImageUrl}`);
      } else {
        console.log(`    Onboarding: NONE`);
      }

      const docs = await SellerDocument.find({ sellerId: s._id }).lean();
      console.log(`    Documents (${docs.length}):`);
      for (const d of docs) {
        console.log(`      - [${d.documentType}] status=${d.verificationStatus} url=${d.fileUrl}`);
      }
    }
  }
  await disconnectDatabase();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
