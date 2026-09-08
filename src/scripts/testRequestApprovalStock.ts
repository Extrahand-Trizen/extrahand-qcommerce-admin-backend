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
import { SellerCatalogueService } from '../services/SellerCatalogueService';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`❌ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run() {
  await connectDatabase();
  const ts = Date.now();
  const created: mongoose.Types.ObjectId[] = [];

  const category = await Category.create({
    name: `RA Cat ${ts}`, slug: `ra-cat-${ts}`, code: ('R' + Math.random().toString(36).slice(2, 6)).toUpperCase(), status: 'ACTIVE',
  });
  const subcategory = await Subcategory.create({
    categoryId: category._id, name: `RA Sub ${ts}`, slug: `ra-sub-${ts}`, status: 'ACTIVE',
  });
  const productType = await ProductType.create({
    categoryId: category._id, subcategoryId: subcategory._id, name: `RA Type ${ts}`, slug: `ra-type-${ts}`, status: 'ACTIVE',
  });
  const seller = await Seller.create({
    userId: `ra-user-${ts}`, fullName: 'RA Seller', mobileNumber: `9${String(ts).slice(-9)}`,
    status: 'ACTIVE', onboardingStatus: 'APPROVED',
  });

  console.log('\n=== Seller submits a product request with stock + lifespan ===');
  const submission = await ProductSubmission.create({
    sellerId: seller._id,
    submittedProductName: `RA Milk ${ts}`,
    categoryId: category._id,
    packOrSoldAs: '1 L',
    sellingPricePaise: 6000,
    quantity: 30,
    lifespanValue: 5,
    lifespanUnit: 'Days',
    requestedAttributes: [],
    images: [],
    status: 'PENDING',
  });
  assert(submission.quantity === 30, 'Submission stored requested stock = 30');
  assert(submission.lifespanValue === 5, 'Submission stored lifespan = 5 Days');

  console.log('\n=== Admin approves (create master product + seller listing) ===');
  await ProductSubmissionService.review(
    String(submission._id), 'APPROVE', 'looks good', 'admin-ra',
    {
      subcategoryId: String(subcategory._id),
      productTypeId: String(productType._id),
      sellingPricePaise: 6000,
      quantity: 30,
      lifespanValue: 5,
      lifespanUnit: 'Days',
      createSellerListing: true,
    },
  );

  const approved = await ProductSubmission.findById(submission._id).lean();
  assert(approved?.status === 'APPROVED', 'Submission is APPROVED');
  const masterId = approved!.mappedMasterProductId!;
  created.push(masterId as mongoose.Types.ObjectId);

  const master = await MasterProduct.findById(masterId).lean();
  assert(master?.lifespanValue === 5 && master?.lifespanUnit === 'Days', 'MasterProduct carries lifespan 5 Days');

  const listing = await SellerListing.findOne({ sellerId: seller._id, masterProductId: masterId }).lean();
  assert(!!listing, 'SellerListing was created on approval');
  assert(listing!.stock === 30, 'SellerListing.stock = 30 (from requested quantity)');
  assert(listing!.availability === 'AVAILABLE', 'SellerListing availability = AVAILABLE');

  const inv = await ShopInventory.findOne({ sellerId: seller._id, listingId: listing!._id }).lean();
  assert(inv?.stock === 30 && inv?.reserved === 0, 'ShopInventory mirrors stock = 30, reserved = 0');

  console.log('\n=== "My store" list shows stock + lifespan ===');
  const mine = await SellerCatalogueService.listMyListings(String(seller._id), { limit: 100 });
  const row = mine.items.find((i) => i.masterProductId === String(masterId));
  assert(!!row, 'Listing appears in listMyListings');
  assert(row!.stock === 30 && row!.available === 30, 'Store row: stock 30, available 30');
  assert(row!.lifespanValue === 5 && row!.lifespanUnit === 'Days', 'Store row: lifespan 5 Days');

  const detail = await SellerCatalogueService.getListingDetail(String(seller._id), String(listing!._id));
  assert(detail.listing.stock === 30 && detail.listing.available === 30, 'Detail: stock/available = 30');
  assert(detail.master.lifespanValue === 5 && detail.master.lifespanUnit === 'Days', 'Detail: master lifespan 5 Days');

  console.log('\n=== Seller updates stock from the app ===');
  await SellerCatalogueService.updateListing(String(seller._id), String(listing!._id), { stock: 12 });
  const afterUpdate = await SellerListing.findById(listing!._id).lean();
  assert(afterUpdate!.stock === 12, 'updateListing set stock = 12');

  // cleanup
  console.log('\n--- cleanup ---');
  await Promise.all([
    ProductSubmission.deleteOne({ _id: submission._id }),
    MasterProduct.deleteOne({ _id: masterId }),
    SellerListing.deleteMany({ sellerId: seller._id }),
    ShopInventory.deleteMany({ sellerId: seller._id }),
    Seller.deleteOne({ _id: seller._id }),
    ProductType.deleteOne({ _id: productType._id }),
    Subcategory.deleteOne({ _id: subcategory._id }),
    Category.deleteOne({ _id: category._id }),
  ]);
  console.log('\n🎉 REQUEST → APPROVAL → STORE STOCK/LIFESPAN: ALL CHECKS PASSED\n');
  await disconnectDatabase();
  process.exit(0);
}

run().catch(async (e) => {
  console.error('\n', e);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
