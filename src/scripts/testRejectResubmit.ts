import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerDocument from '../models/SellerDocument';
import SellerApprovalHistory from '../models/SellerApprovalHistory';
import { SellerService } from '../services/SellerService';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`❌ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run() {
  await connectDatabase();
  const ts = Date.now();

  const seller = await Seller.create({
    userId: `rr-user-${ts}`, fullName: 'RR Seller', mobileNumber: `9${String(ts).slice(-9)}`,
    status: 'PENDING', onboardingStatus: 'DRAFT',
  });
  const sid = String(seller._id);

  const baseFields = {
    fullName: 'RR Seller', mobileNumber: `9${String(ts).slice(-9)}`,
    shopName: `RR Shop ${ts}`, address: '1 Test St', city: 'Testville', state: 'TS', pincode: '500001',
    pan: 'ABCDE1234F', gstin: '22ABCDE1234F1Z5', fssaiNumber: '12345678901234',
  };
  await SellerService.saveOnboarding(sid, { ...baseFields }, false);
  const obDoc = await SellerOnboarding.findOne({ sellerId: seller._id });
  await SellerDocument.create({
    sellerId: seller._id, onboardingId: obDoc!._id, documentType: 'FSSAI_CERTIFICATE',
    fileUrl: 'https://x/fssai.jpg', fileName: 'fssai.jpg', mimeType: 'image/jpeg', fileSize: 1,
  });
  await SellerDocument.create({
    sellerId: seller._id, onboardingId: obDoc!._id, documentType: 'SHOP_IMAGE',
    fileUrl: 'https://x/shop.jpg', fileName: 'shop.jpg', mimeType: 'image/jpeg', fileSize: 1,
  });

  console.log('\n=== Seller submits ===');
  await SellerService.saveOnboarding(sid, {}, true);
  let ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  let s = await Seller.findById(seller._id).lean();
  assert(ob?.status === 'PENDING_APPROVAL', 'onboarding → PENDING_APPROVAL');
  assert(s?.onboardingStatus === 'PENDING_APPROVAL', 'seller.onboardingStatus → PENDING_APPROVAL');

  console.log('\n=== Admin rejects ===');
  await SellerService.reviewOnboarding(sid, 'REJECT', 'Shop photo unclear', 'admin-rr');
  ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  s = await Seller.findById(seller._id).lean();
  assert(ob?.status === 'REJECTED', 'onboarding → REJECTED');
  assert(s?.status === 'REJECTED', 'seller.status → REJECTED');
  assert(ob?.adminComment === 'Shop photo unclear', 'admin comment stored for the seller to read');

  console.log('\n=== Seller edits a field and resubmits ===');
  await SellerService.saveOnboarding(sid, { shopDescription: 'Now with a clearer photo' }, true);
  ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  s = await Seller.findById(seller._id).lean();
  assert(ob?.status === 'PENDING_APPROVAL', 'onboarding back → PENDING_APPROVAL');
  assert(s?.status === 'PENDING', 'seller.status cleared REJECTED → PENDING');
  assert(s?.onboardingStatus === 'PENDING_APPROVAL', 'seller.onboardingStatus → PENDING_APPROVAL');
  assert(!ob?.adminComment, 'stale admin comment cleared on resubmit');
  assert(ob?.shopDescription === 'Now with a clearer photo', 'edited field persisted');

  const history = await SellerApprovalHistory.find({ sellerId: seller._id }).sort({ performedAt: 1 }).lean();
  const actions = history.map((h) => h.action);
  assert(actions.includes('RESUBMITTED'), `history records RESUBMITTED (got ${actions.join(', ')})`);

  console.log('\n=== Admin approves the resubmission ===');
  await SellerService.reviewOnboarding(sid, 'APPROVE', undefined, 'admin-rr');
  ob = await SellerOnboarding.findOne({ sellerId: seller._id }).lean();
  s = await Seller.findById(seller._id).lean();
  assert(ob?.status === 'APPROVED' && s?.status === 'ACTIVE', 'approved after resubmission → seller ACTIVE');

  console.log('\n--- cleanup ---');
  await Promise.all([
    Seller.deleteOne({ _id: seller._id }),
    SellerOnboarding.deleteMany({ sellerId: seller._id }),
    SellerDocument.deleteMany({ sellerId: seller._id }),
    SellerApprovalHistory.deleteMany({ sellerId: seller._id }),
  ]);

  console.log('\n🎉 REJECT → EDIT → RESUBMIT → APPROVE: ALL CHECKS PASSED\n');
  await disconnectDatabase();
  process.exit(0);
}

run().catch(async (e) => {
  console.error('\n', e);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
