import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import Seller from '../models/Seller';
import ProductSubmission from '../models/ProductSubmission';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import ShopInventory from '../models/ShopInventory';
import { ProductSubmissionService } from '../services/ProductSubmissionService';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`❌ Assertion Failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run() {
  await connectDatabase();
  const ts = Date.now();
  console.log('=== Starting Medical Product Workflow Verification ===\n');

  // Find or create Pharmacy category
  let pharmacyCat = await Category.findOne({ slug: 'pharmacy-medicines' });
  if (!pharmacyCat) {
    pharmacyCat = await Category.create({
      name: 'Pharmacy & Medicines',
      slug: 'pharmacy-medicines',
      code: 'PHARM' + Math.random().toString(36).slice(2, 5).toUpperCase(),
      status: 'ACTIVE',
    });
  }

  const subcategory = await Subcategory.create({
    categoryId: pharmacyCat._id,
    name: `Cardiovascular ${ts}`,
    slug: `cardio-${ts}`,
    status: 'ACTIVE',
  });

  const productType = await ProductType.create({
    categoryId: pharmacyCat._id,
    subcategoryId: subcategory._id,
    name: `Tablets ${ts}`,
    slug: `tablets-${ts}`,
    status: 'ACTIVE',
  });

  const seller = await Seller.create({
    userId: `med-user-${ts}`,
    fullName: 'Dr. Reddy Medico',
    shopName: 'Apollo City Pharmacy',
    mobileNumber: `9${String(ts).slice(-9)}`,
    status: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  });

  console.log('Step 1: Seller submits a Medical Product request');
  const medicalSubmission = await ProductSubmissionService.createRequest(
    String(seller._id),
    {
      name: `Amoxicillin & Potassium Clavulanate 625mg ${ts}`,
      categoryId: String(pharmacyCat._id),
      subcategoryId: String(subcategory._id),
      productTypeId: String(productType._id),
      brand: 'Augmentin 625 Duo',
      manufacturerName: 'GlaxoSmithKline Pharmaceuticals Ltd',
      manufacturerAddress: 'Dr. Annie Besant Road, Worli, Mumbai 400030',
      description: 'Broad-spectrum antibiotic for bacterial respiratory and skin infections.',
      sellingPricePaise: 18500, // Rs. 185
      quantity: 50,
      photoUrl: 'https://cdn.example.com/med/augmentin-front.png',
      images: [
        'https://cdn.example.com/med/augmentin-front.png',
        'https://cdn.example.com/med/augmentin-back.png',
      ],

      // Medical fields
      isMedicalProduct: true,
      productType: 'Allopathy',
      medicalCategory: 'Cardiovascular & Anti-Infective',
      medicalSubcategory: 'Penicillins & Beta-Lactamase Inhibitors',
      genericName: 'Amoxicillin (500mg) + Clavulanic Acid (125mg)',
      dosageForm: 'Tablet',
      routeOfAdmin: 'Oral',
      strength: '625',
      strengthUnit: 'mg',
      packSize: '10 Tablets Strip',
      packagingType: 'Alu-Alu Strip',
      netContent: '10 Tablets',
      releaseType: 'Immediate Release',
      productForm: 'Film-coated tablet',
      indication: 'Treatment of respiratory tract, ear, nose, throat and dental infections',
      directionsForUse: 'As directed by physician. Swallow whole with water with meals.',
      keyBenefits: 'Overcomes bacterial resistance to amoxicillin with potassium clavulanate.',
      keyIngredients: 'Amoxicillin Trihydrate IP eq. to Amoxicillin 500mg, Potassium Clavulanate IP eq. to Clavulanic Acid 125mg',
      safetyInfo: 'Schedule H1 Prescription Drug. Warning: To be sold by retail on prescription of RMP only.',
      sideEffects: 'Mild nausea, diarrhoea, headache',
      allergenInfo: 'Contraindicated in patients with penicillin hypersensitivity',
      storageCondition: 'Store below 25°C in a dry place. Protect from light and moisture.',
      disclaimer: 'Not recommended for self-medication.',
      sterility: 'Non-sterile',
      useType: 'Internal',
      marketerName: 'GSK Consumer India',
      countryOfOrigin: 'India',
      licenceNumber: 'MH-DR-1092834',
      prescriptionCategory: 'Schedule H1 / Rx Required',
      regulatoryInfo: 'Schedule H1 Drug under Drugs and Cosmetics Act',
      mrpPaise: 21500, // Rs. 215
      unitOfSale: 'Strip',
      batchNumber: 'AUG2026-X1',
      mfgDate: '2026-03-01',
      expiryDate: '2028-02-28',
      rackLocation: 'Rack B-14 Drawer 2',
      coldChainRequired: false,
      prescriptionDocUrl: 'https://cdn.example.com/med/dr-licence.pdf',
      additionalNotes: 'Urgent stock for hospital OPD',
    },
  );

  assert(medicalSubmission.status === 'PENDING', 'Submission status is PENDING');
  assert(Boolean(medicalSubmission.isMedicalProduct), 'isMedicalProduct flag is true');
  assert(Boolean(medicalSubmission.genericName?.includes('Amoxicillin')), 'Generic name persisted accurately');
  assert(medicalSubmission.prescriptionCategory === 'Schedule H1 / Rx Required', 'Prescription category persisted');
  assert(medicalSubmission.batchNumber === 'AUG2026-X1', 'Batch number persisted');
  assert(medicalSubmission.expiryDate === '2028-02-28', 'Expiry date persisted');
  assert(medicalSubmission.mrpPaise === 21500, 'MRP persisted correctly');

  console.log('\nStep 2: Seller views their requests (MyRequests query)');
  const sellerRequests = await ProductSubmissionService.listMine(String(seller._id), { page: 1, limit: 10 });
  assert(sellerRequests.items.length >= 1, 'Seller can list and retrieve their submitted requests');
  const foundReq = sellerRequests.items.find((item: any) => item._id.toString() === medicalSubmission._id.toString()) as any;
  assert(!!foundReq, 'Found submitted medical request in seller list');
  assert(foundReq.genericName === 'Amoxicillin (500mg) + Clavulanic Acid (125mg)', 'Seller list retains generic name');

  console.log('\nStep 3: Admin reviews and approves the Medical Product');
  const reviewed = await ProductSubmissionService.review(
    String(medicalSubmission._id),
    'APPROVE',
    'Verified Schedule H1 license and batch details. Approved.',
    'admin-tester-id',
    {
      subcategoryId: String(subcategory._id),
      productTypeId: String(productType._id),
      name: medicalSubmission.submittedProductName,
      brand: medicalSubmission.brand,
      sellingPricePaise: medicalSubmission.sellingPricePaise,
      quantity: medicalSubmission.quantity,
      addToMasterCatalogue: true,
      createSellerListing: true,
    },
  );

  assert(reviewed.status === 'APPROVED', 'Submission status updated to APPROVED');
  assert(!!reviewed.mappedMasterProductId, 'MasterProduct ID mapped on approval');

  console.log('\nStep 4: Verify MasterProduct has medical details in productInformation');
  const masterProduct = await MasterProduct.findById(reviewed.mappedMasterProductId);
  assert(!!masterProduct, 'MasterProduct exists in database');
  assert(masterProduct?.status === 'ACTIVE', 'MasterProduct status is ACTIVE in catalogue');
  assert(masterProduct?.productInformation?.genericName === 'Amoxicillin (500mg) + Clavulanic Acid (125mg)', 'MasterProduct has genericName');
  assert(masterProduct?.productInformation?.dosageForm === 'Tablet', 'MasterProduct has dosageForm');
  assert(masterProduct?.productInformation?.prescriptionCategory === 'Schedule H1 / Rx Required', 'MasterProduct has prescriptionCategory');

  console.log('\nStep 5: Verify SellerListing has customProductInformation with batch/inventory');
  const sellerListing = await SellerListing.findOne({
    sellerId: seller._id,
    masterProductId: masterProduct?._id,
  });
  assert(!!sellerListing, 'SellerListing created for the store');
  assert(sellerListing?.status === 'ACTIVE', 'SellerListing status is ACTIVE');
  assert(sellerListing?.stock === 50, 'SellerListing has stock = 50');
  assert(sellerListing?.sellingPricePaise === 18500, 'SellerListing price = 18500');
  const customInfo = (sellerListing as any)?.customProductInformation;
  assert(customInfo?.batchNumber === 'AUG2026-X1', 'SellerListing customProductInformation has batchNumber');
  assert(customInfo?.expiryDate === '2028-02-28', 'SellerListing customProductInformation has expiryDate');
  assert(customInfo?.rackLocation === 'Rack B-14 Drawer 2', 'SellerListing customProductInformation has rackLocation');

  console.log('\nStep 6: Verify cleanup of test data');
  await ShopInventory.deleteMany({ sellerId: seller._id });
  await SellerListing.deleteMany({ sellerId: seller._id });
  await MasterProduct.findByIdAndDelete(masterProduct?._id);
  await ProductSubmission.findByIdAndDelete(medicalSubmission._id);
  await Seller.findByIdAndDelete(seller._id);
  await ProductType.findByIdAndDelete(productType._id);
  await Subcategory.findByIdAndDelete(subcategory._id);
  console.log('  ✓ Test documents cleaned up cleanly');

  console.log('\n🎉 ALL MEDICAL PRODUCT WORKFLOW TESTS PASSED SUCCESSFULLY! 🎉\n');
  await disconnectDatabase();
}

run().catch(async (err) => {
  console.error('❌ Test failed with error:', err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
