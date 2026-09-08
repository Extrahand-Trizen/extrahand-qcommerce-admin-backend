import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import ShopInventory from '../models/ShopInventory';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import CustomerCart from '../models/CustomerCart';
import { InventoryService } from '../services/InventoryService';
import { SellerCatalogueService } from '../services/SellerCatalogueService';
import { StorefrontService } from '../services/StorefrontService';
import { CustomerStoreService } from '../services/CustomerStoreService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log('--- Starting Product Lifespan & Shop Inventory Tests ---');
  await connectDatabase();

  const timestamp = Date.now();
  const testCategorySlug = `test-cat-${timestamp}`;
  const testSellerAId = new mongoose.Types.ObjectId();
  const testSellerBId = new mongoose.Types.ObjectId();
  const testCustomerId = `test-cust-${timestamp}`;

  // Clean up any stray test categories
  await Category.deleteMany({ code: /^T[A-Z0-9]{4}$/ });

  // 1. Setup base category & master product
  const uniqueCode = ('T' + Math.random().toString(36).substring(2, 6)).toUpperCase();
  const category = await Category.create({
    name: `Test Dairy ${timestamp}`,
    slug: testCategorySlug,
    code: uniqueCode,
    status: 'ACTIVE',
  });

  const subcategory = await Subcategory.create({
    categoryId: category._id,
    name: 'Test Milk Subcat',
    slug: `test-milk-${timestamp}`,
    status: 'ACTIVE',
  });

  const productType = await ProductType.create({
    categoryId: category._id,
    subcategoryId: subcategory._id,
    name: 'Test Milk Type',
    slug: `test-milk-type-${timestamp}`,
    status: 'ACTIVE',
  });

  const masterProduct = await MasterProduct.create({
    name: 'Fresh Cow Milk 1L',
    slug: `fresh-cow-milk-1l-${timestamp}`,
    sku: `MP-MILK-${timestamp}`,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    productTypeId: productType._id,
    sellingPricePaise: 6000,
    status: 'ACTIVE',
    lifespanValue: 7,
    lifespanUnit: 'Days',
  });

  console.log('\n=== TEST 1: Lifespan Attribute Persistence (Requirement 1) ===');
  assert(masterProduct.lifespanValue === 7, 'MasterProduct correctly stored lifespanValue = 7');
  assert(masterProduct.lifespanUnit === 'Days', 'MasterProduct correctly stored lifespanUnit = Days');

  console.log('\n=== TEST 2: Shop A vs Shop B Stock Isolation (Requirement 2) ===');
  // Shop A lists product with stock 20
  const listingA = await SellerCatalogueService.addListing(testSellerAId.toString(), {
    masterProductId: masterProduct._id.toString(),
    sellingPricePaise: 6000,
    stock: 20,
  });

  // Shop B lists product with stock 8
  const listingB = await SellerCatalogueService.addListing(testSellerBId.toString(), {
    masterProductId: masterProduct._id.toString(),
    sellingPricePaise: 6500,
    stock: 8,
  });

  let invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  let invB = await ShopInventory.findOne({ sellerId: testSellerBId, listingId: listingB.id });
  assert(invA !== null && invA.stock === 20 && invA.available === 20, 'Shop A initial stock = 20, available = 20');
  assert(invB !== null && invB.stock === 8 && invB.available === 8, 'Shop B initial stock = 8, available = 8');

  // Change Shop A's stock to 25
  await SellerCatalogueService.updateListing(testSellerAId.toString(), listingA.id, {
    stock: 25,
  });

  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  invB = await ShopInventory.findOne({ sellerId: testSellerBId, listingId: listingB.id });
  assert(invA !== null && invA.stock === 25 && invA.available === 25, 'Shop A stock updated to 25');
  assert(invB !== null && invB.stock === 8 && invB.available === 8, 'Shop B stock remains untouched at 8 (STRICT ISOLATION VERIFIED)');

  console.log('\n=== TEST 3: Available = Stock - Reserved Calculation (Requirement 3) ===');
  // Reserve 5 units for Shop A
  await InventoryService.reserveOrderStock(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 5,
  }]);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.stock === 25, 'Shop A stock remains 25');
  assert(invA !== null && invA.reserved === 5, 'Shop A reserved is 5');
  assert(invA !== null && invA.available === 20, 'Shop A available is 20 (25 - 5)');

  // Release the 5 reserved units
  await InventoryService.releaseOrderStock(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 5,
  }]);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.reserved === 0 && invA.available === 25, 'Shop A released reservation: reserved = 0, available = 25');

  console.log('\n=== TEST 4: Customer Cart & Backend Checkout Stock Validation (Requirement 3 & 6) ===');
  // Reset Shop A stock to 20 for convenience
  await InventoryService.setStock(testSellerAId, listingA.id, 20);

  // Attempt to add 21 items to cart (exceeding available 20)
  let cartErrorThrown = false;
  try {
    await CustomerStoreService.upsertCartItem(testCustomerId, {
      productSlug: masterProduct.slug,
      quantity: 21,
    }, { sellerId: testSellerAId.toString() });
  } catch (err: any) {
    cartErrorThrown = true;
    assert(err.message.includes('stock') || err.message.includes('Only 20 available'), 'Cart rejects quantity exceeding available stock');
  }
  assert(cartErrorThrown, 'Adding more than available stock to cart threw an error');

  // Add 20 items to cart (valid)
  await CustomerStoreService.upsertCartItem(testCustomerId, {
    productSlug: masterProduct.slug,
    quantity: 20,
  }, { sellerId: testSellerAId.toString() });
  const cart = await CustomerCart.findOne({ userId: testCustomerId });
  assert(cart !== null && cart.items.length === 1 && cart.items[0].quantity === 20, 'Cart allowed adding up to available stock (20)');

  // Attempting to reserve 25 units when only 20 available should fail
  let reserveErrorThrown = false;
  try {
    await InventoryService.reserveOrderStock(testSellerAId, [{
      masterProductId: masterProduct._id,
      quantity: 25,
    }]);
  } catch (err: any) {
    reserveErrorThrown = true;
    assert(err.message.includes('Only 20 available in this shop') || err.message.includes('available'), 'InventoryService correctly blocks over-reservation at checkout');
  }
  assert(reserveErrorThrown, 'Backend checkout validation rejected over-reservation');

  console.log('\n=== TEST 5: Order Acceptance Finalizes Stock Deduction (Requirement 4) ===');
  // Order 1: customer orders 3 units
  await InventoryService.reserveOrderStock(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 3,
  }]);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.stock === 20 && invA.reserved === 3 && invA.available === 17, 'Order 1 reserved 3 units: stock = 20, reserved = 3, available = 17');

  // Seller accepts order -> stock -= 3, reserved -= 3
  await InventoryService.finalizeOrderDeduction(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 3,
  }]);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.stock === 17 && invA.reserved === 0 && invA.available === 17, 'Order 1 accepted: stock = 17, reserved = 0, available = 17');

  console.log('\n=== TEST 6: Order Rejection Releases Reserved Quantity (Requirement 4) ===');
  // Order 2: customer orders 2 units
  await InventoryService.reserveOrderStock(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 2,
  }]);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.stock === 17 && invA.reserved === 2 && invA.available === 15, 'Order 2 reserved 2 units: stock = 17, reserved = 2, available = 15');

  // Seller rejects order -> reserved -= 2, available restores to 17
  await InventoryService.releaseOrderStock(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 2,
  }]);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.stock === 17 && invA.reserved === 0 && invA.available === 17, 'Order 2 rejected: stock = 17, reserved = 0, available = 17');

  console.log('\n=== TEST 7: Order Timeout / Abandonment Releases Reserved Quantity (Requirement 4) ===');
  // Order 3: customer orders 4 units
  await InventoryService.reserveOrderStock(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 4,
  }]);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.stock === 17 && invA.reserved === 4 && invA.available === 13, 'Order 3 reserved 4 units: stock = 17, reserved = 4, available = 13');

  // Timeout / autoReject occurs -> reserved -= 4
  await InventoryService.releaseOrderStock(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 4,
  }]);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.stock === 17 && invA.reserved === 0 && invA.available === 17, 'Order 3 timed out: stock = 17, reserved = 0, available = 17');

  console.log('\n=== TEST 8: Out of Stock & Restocking Recovery (Requirement 5) ===');
  // Reserve and finalize remaining 17 units to reach 0 stock
  await InventoryService.reserveOrderStock(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 17,
  }]);
  await InventoryService.finalizeOrderDeduction(testSellerAId, [{
    masterProductId: masterProduct._id,
    quantity: 17,
  }]);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.stock === 0 && invA.available === 0, 'Stock reduced to 0: stock = 0, available = 0');

  // Verify Storefront status is OUT_OF_STOCK / inStock: false
  const productMapZero = await StorefrontService.resolveProductsBySlugs([masterProduct.slug], { sellerId: testSellerAId.toString() });
  const storeProductZero = productMapZero.get(masterProduct.slug);
  assert(storeProductZero !== undefined && storeProductZero.inStock === false, 'Storefront reports inStock: false when available is 0');
  assert(storeProductZero !== undefined && storeProductZero.purchasable === false, 'Storefront reports purchasable: false when available is 0');

  // Restock (+10 units)
  await InventoryService.setStock(testSellerAId, listingA.id, 10);
  invA = await ShopInventory.findOne({ sellerId: testSellerAId, listingId: listingA.id });
  assert(invA !== null && invA.stock === 10 && invA.available === 10, 'Restocked: stock = 10, available = 10');

  const productMapRestocked = await StorefrontService.resolveProductsBySlugs([masterProduct.slug], { sellerId: testSellerAId.toString() });
  const storeProductRestocked = productMapRestocked.get(masterProduct.slug);
  assert(storeProductRestocked !== undefined && storeProductRestocked.inStock === true, 'Storefront reports inStock: true when restocked');
  assert(storeProductRestocked !== undefined && storeProductRestocked.purchasable === true, 'Storefront reports purchasable: true when restocked');

  console.log('\n=== TEST 9: Storefront Display of Lifespan & Product Active (Requirement 1) ===');
  const storefrontDetail = await StorefrontService.getProductBySlug(masterProduct.slug, { sellerId: testSellerAId.toString() });
  assert(storefrontDetail !== null, 'Storefront retrieved product by slug');
  assert(storefrontDetail?.product?.lifespanValue === 7, 'Storefront product has lifespanValue = 7');
  assert(storefrontDetail?.product?.lifespanUnit === 'Days', 'Storefront product has lifespanUnit = Days');
  const hasLifespanHighlight = Boolean(storefrontDetail?.highlights?.some((h) => h.label === 'Lifespan' && h.value.includes('7 Days')));
  assert(hasLifespanHighlight, 'Storefront product highlights include "Lifespan: 7 Days"');
  assert(storefrontDetail?.product?.inStock === true && storefrontDetail?.product?.purchasable === true, 'Product is active and inStock (no automatic expiration or disabling)');

  // Cleanup test records
  console.log('\n--- Cleaning up test records ---');
  await ShopInventory.deleteMany({ _id: { $in: [invA?._id, invB?._id] } });
  await SellerListing.deleteMany({ _id: { $in: [listingA.id, listingB.id] } });
  await MasterProduct.deleteOne({ _id: masterProduct._id });
  await ProductType.deleteOne({ _id: productType._id });
  await Subcategory.deleteOne({ _id: subcategory._id });
  await Category.deleteOne({ _id: category._id });
  await CustomerCart.deleteMany({ userId: testCustomerId });

  console.log('\n🎉 ALL 9 VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉\n');
  await disconnectDatabase();
  process.exit(0);
}

runTests().catch(async (err) => {
  console.error('\n❌ Test execution failed with error:', err);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
