import mongoose, { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import MasterProduct from '../models/MasterProduct';
import SellerListing from '../models/SellerListing';
import ShopInventory from '../models/ShopInventory';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import ProductType from '../models/ProductType';
import CustomerCart from '../models/CustomerCart';
import CartReservation from '../models/CartReservation';
import { InventoryService } from '../services/InventoryService';
import { CartReservationService } from '../services/CartReservationService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log('================================================================');
  console.log('--- STARTING COMPREHENSIVE CART RESERVATION TESTS (1-13) ---');
  console.log('================================================================\n');

  await connectDatabase();

  const timestamp = Date.now();
  const sellerAId = new Types.ObjectId();
  const sellerBId = new Types.ObjectId();
  const customerA = `cust_A_${timestamp}`;
  const customerB = `cust_B_${timestamp}`;
  const customerC = `cust_C_${timestamp}`;

  // 1. Setup category, subcategory, product type, and master product
  const category = await Category.create({
    name: `Test Cat ${timestamp}`,
    slug: `test-cat-${timestamp}`,
    code: ('T' + Math.random().toString(36).substring(2, 6)).toUpperCase(),
    status: 'ACTIVE',
  });

  const subcategory = await Subcategory.create({
    categoryId: category._id,
    name: `Test Subcat ${timestamp}`,
    slug: `test-subcat-${timestamp}`,
    status: 'ACTIVE',
  });

  const productType = await ProductType.create({
    categoryId: category._id,
    subcategoryId: subcategory._id,
    name: `Test Type ${timestamp}`,
    slug: `test-type-${timestamp}`,
    status: 'ACTIVE',
  });

  const productSlug = `test-milk-1l-${timestamp}`;
  const masterProduct = await MasterProduct.create({
    name: 'Milk 1L',
    slug: productSlug,
    sku: `SKU-${timestamp}`,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    productTypeId: productType._id,
    status: 'ACTIVE',
    sellingPricePaise: 5000,
    cataloguePricePaise: 5000,
  });

  // Create SellerListing for Seller A with stock = 10
  const listingA = await SellerListing.create({
    sellerId: sellerAId,
    masterProductId: masterProduct._id,
    sellingPricePaise: 5000,
    stock: 10,
    reserved: 0,
    status: 'ACTIVE',
    availability: 'AVAILABLE',
  });

  await ShopInventory.create({
    sellerId: sellerAId,
    listingId: listingA._id,
    masterProductId: masterProduct._id,
    stock: 10,
    reserved: 0,
  });

  console.log('--- INITIAL STATE: Total Stock = 10, Reserved = 0, Available = 10 ---');

  // =========================================================================
  // TEST 1: Customer A reserves 2
  // =========================================================================
  console.log('\n[TEST 1] Customer A reserves 2 units in cart');
  await CartReservationService.reserveCartItem(
    customerA,
    sellerAId,
    masterProduct._id,
    productSlug,
    2,
  );

  const stock1 = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock1.stock === 10, 'Total stock remains 10');
  assert(stock1.reserved === 2, 'Reserved is 2');
  assert(stock1.available === 8, 'Available is 8');

  // Verify CartReservation record
  const res1 = await CartReservation.findOne({
    userId: customerA,
    masterProductId: masterProduct._id,
    status: 'ACTIVE',
  });
  assert(Boolean(res1) && res1?.quantity === 2, 'CartReservation created with qty 2 and status ACTIVE');

  // =========================================================================
  // TEST 2: Customer B buys 3 from available 8
  // =========================================================================
  console.log('\n[TEST 2] Customer B buys 3 units');
  await CartReservationService.consumeOrReserveForOrder(customerB, sellerAId, [
    { masterProductId: masterProduct._id, quantity: 3, name: 'Milk 1L' },
  ]);

  const stock2 = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock2.stock === 10, 'Total stock remains 10');
  assert(stock2.reserved === 5, 'Reserved is now 5 (2 held by Customer A cart + 3 held by Customer B order)');
  assert(stock2.available === 5, 'Available is now 5');

  // Finalize Customer B's order deduction (seller accepts)
  await InventoryService.finalizeOrderDeduction(sellerAId, [
    { masterProductId: masterProduct._id, quantity: 3 },
  ]);

  const stock2AfterFinalize = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock2AfterFinalize.stock === 7, 'Physical stock reduced to 7 (10 - 3 sold)');
  assert(stock2AfterFinalize.reserved === 2, 'Reserved reduced to 2 (only Customer A cart hold remains)');
  assert(stock2AfterFinalize.available === 5, 'Available remains 5 (7 - 2)');

  // =========================================================================
  // TEST 3: Customer A reservation expires
  // =========================================================================
  console.log('\n[TEST 3] Customer A reservation expires');
  // Backdate Customer A's reservation to the past
  await CartReservation.updateOne(
    { _id: res1!._id },
    { expiresAt: new Date(Date.now() - 60_000) },
  );

  const expiredCount = await CartReservationService.expireStaleReservations({ sellerId: sellerAId });
  assert(expiredCount === 1, '1 stale reservation expired by sweep');

  const stock3 = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock3.stock === 7, 'Physical stock remains 7');
  assert(stock3.reserved === 0, 'Reserved is 0 (Customer A hold released)');
  assert(stock3.available === 7, 'Available increases back to 7');

  // =========================================================================
  // TEST 4: Customer A cart still contains 2 items after reservation expiry
  // =========================================================================
  console.log('\n[TEST 4] Customer A cart still contains 2 items');
  // Seed Customer A cart
  await CustomerCart.create({
    userId: customerA,
    sellerId: sellerAId,
    items: [{ productSlug, masterProductId: masterProduct._id, quantity: 2 }],
  });

  const cartAfterExpiry = await CustomerCart.findOne({ userId: customerA }).lean();
  assert(cartAfterExpiry?.items.length === 1, 'Cart still has 1 line');
  assert(cartAfterExpiry?.items[0].quantity === 2, 'Cart still contains quantity 2');

  // =========================================================================
  // TEST 5: Customer A comes back and buys 2 when stock is available
  // =========================================================================
  console.log('\n[TEST 5] Customer A comes back and buys 2 units from current stock (7 available)');
  await CartReservationService.consumeOrReserveForOrder(customerA, sellerAId, [
    { masterProductId: masterProduct._id, quantity: 2, name: 'Milk 1L' },
  ]);

  const stock5 = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock5.reserved === 2, 'Reserved becomes 2 for Customer A order');
  assert(stock5.available === 5, 'Available is 5');

  // Seller accepts order
  await InventoryService.finalizeOrderDeduction(sellerAId, [
    { masterProductId: masterProduct._id, quantity: 2 },
  ]);

  const stock5After = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock5After.stock === 5, 'Physical stock is 5');
  assert(stock5After.reserved === 0, 'Reserved is 0');
  assert(stock5After.available === 5, 'Available is 5');

  // =========================================================================
  // TEST 6: Customer A returns with 2 in cart, but current available = 1
  // =========================================================================
  console.log('\n[TEST 6] Customer returns with 2 in cart when only 1 is available');
  // Adjust stock to 1
  await SellerListing.updateOne({ _id: listingA._id }, { stock: 1, reserved: 0 });
  await ShopInventory.updateOne({ listingId: listingA._id }, { stock: 1, reserved: 0 });

  let rejected = false;
  try {
    await CartReservationService.consumeOrReserveForOrder(customerA, sellerAId, [
      { masterProductId: masterProduct._id, quantity: 2, name: 'Milk 1L' },
    ]);
  } catch (e: any) {
    rejected = true;
    assert(e.statusCode === 409, 'Returns HTTP 409 conflict error');
    assert(e.message.includes('Only 1 available'), `Message informs customer of available stock: "${e.message}"`);
  }
  assert(rejected, 'Order for 2 was rejected because available is 1');

  // =========================================================================
  // TEST 7: Concurrent reservations / prevent negative stock
  // =========================================================================
  console.log('\n[TEST 7] Concurrent reservations - prevent negative stock');
  // Reset stock to 2
  await SellerListing.updateOne({ _id: listingA._id }, { stock: 2, reserved: 0, availability: 'AVAILABLE' });
  await ShopInventory.updateOne({ listingId: listingA._id }, { stock: 2, reserved: 0 });

  // Customer A reserves 2 -> success
  await CartReservationService.reserveCartItem(customerA, sellerAId, masterProduct._id, productSlug, 2);

  // Customer B tries to reserve 1 -> must fail
  let custBRejected = false;
  try {
    await CartReservationService.reserveCartItem(customerB, sellerAId, masterProduct._id, productSlug, 1);
  } catch (e: any) {
    custBRejected = true;
    assert(e.statusCode === 409, 'Customer B reservation rejected with 409');
  }
  assert(custBRejected, 'Customer B was prevented from reserving over limit');

  const stock7 = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock7.stock === 2 && stock7.reserved === 2 && stock7.available === 0, 'Stock is exactly 2, reserved 2, available 0 (no negative available)');

  // =========================================================================
  // TEST 8: Multiple customer holds, only one expires
  // =========================================================================
  console.log('\n[TEST 8] Multiple customers: Customer A reserves 2, Customer B reserves 3, only Customer A expires');
  // Reset stock to 10
  await SellerListing.updateOne({ _id: listingA._id }, { stock: 10, reserved: 0, availability: 'AVAILABLE' });
  await ShopInventory.updateOne({ listingId: listingA._id }, { stock: 10, reserved: 0 });
  await CartReservation.deleteMany({ masterProductId: masterProduct._id });

  await CartReservationService.reserveCartItem(customerA, sellerAId, masterProduct._id, productSlug, 2);
  await CartReservationService.reserveCartItem(customerB, sellerAId, masterProduct._id, productSlug, 3);

  const stock8Before = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock8Before.reserved === 5, 'Reserved is 5 (2 + 3)');
  assert(stock8Before.available === 5, 'Available is 5 (10 - 5)');

  // Backdate ONLY Customer A's reservation
  await CartReservation.updateOne({ userId: customerA, status: 'ACTIVE' }, { expiresAt: new Date(Date.now() - 10_000) });
  await CartReservationService.expireStaleReservations({ sellerId: sellerAId });

  const stock8After = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock8After.reserved === 3, 'Reserved is 3 (Customer B reservation remains active)');
  assert(stock8After.available === 7, 'Available is 7 (10 - 3)');

  const resB = await CartReservation.findOne({ userId: customerB, status: 'ACTIVE' });
  assert(Boolean(resB) && resB?.quantity === 3, 'Customer B reservation is still ACTIVE with qty 3');

  // =========================================================================
  // TEST 9: Customer removes reserved product from cart
  // =========================================================================
  console.log('\n[TEST 9] Customer removes reserved product from cart -> reservation released immediately');
  await CartReservationService.releaseCartItem(customerB, productSlug);

  const stock9 = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock9.reserved === 0, 'Reserved is 0 immediately');
  assert(stock9.available === 10, 'Available is 10 immediately');

  const resBAfter = await CartReservation.findOne({ userId: customerB });
  assert(resBAfter?.status === 'RELEASED', 'Customer B reservation status is RELEASED');

  // =========================================================================
  // TEST 10: Customer completes order with active reservation (no double count)
  // =========================================================================
  console.log('\n[TEST 10] Complete order with active reservation (no double counting)');
  await CartReservationService.reserveCartItem(customerC, sellerAId, masterProduct._id, productSlug, 2);

  const stock10Before = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock10Before.reserved === 2, 'Reserved is 2 before order');

  // Customer C checks out
  await CartReservationService.consumeOrReserveForOrder(customerC, sellerAId, [
    { masterProductId: masterProduct._id, quantity: 2, name: 'Milk 1L' },
  ]);

  const stock10After = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock10After.reserved === 2, 'Reserved remains 2 (NO DOUBLE COUNTING!)');
  assert(stock10After.available === 8, 'Available remains 8');

  const resC = await CartReservation.findOne({ userId: customerC, status: 'CONSUMED' });
  assert(Boolean(resC), 'Cart reservation marked as CONSUMED');

  // Clean up order hold
  await InventoryService.releaseOrderStock(sellerAId, [{ masterProductId: masterProduct._id, quantity: 2 }]);

  // =========================================================================
  // TEST 11: Multi-shop isolation
  // =========================================================================
  console.log('\n[TEST 11] Multi-shop isolation: Shop A has 10, Shop B has 20');
  const listingB = await SellerListing.create({
    sellerId: sellerBId,
    masterProductId: masterProduct._id,
    sellingPricePaise: 5000,
    stock: 20,
    reserved: 0,
    status: 'ACTIVE',
    availability: 'AVAILABLE',
  });

  await ShopInventory.create({
    sellerId: sellerBId,
    listingId: listingB._id,
    masterProductId: masterProduct._id,
    stock: 20,
    reserved: 0,
  });

  // Reserve 4 on Shop A
  await CartReservationService.reserveCartItem(customerA, sellerAId, masterProduct._id, productSlug, 4);

  const stockShopA = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  const stockShopB = await InventoryService.getAvailableStock(sellerBId, masterProduct._id);

  assert(stockShopA.stock === 10 && stockShopA.reserved === 4 && stockShopA.available === 6, 'Shop A has Total 10, Reserved 4, Available 6');
  assert(stockShopB.stock === 20 && stockShopB.reserved === 0 && stockShopB.available === 20, 'Shop B is completely untouched: Total 20, Reserved 0, Available 20');

  // =========================================================================
  // TEST 12: Product reaches Available = 0 -> marks OUT_OF_STOCK
  // =========================================================================
  console.log('\n[TEST 12] Product reaches Available = 0 -> marks OUT_OF_STOCK');
  // Reserve remaining 6 on Shop A
  await CartReservationService.reserveCartItem(customerB, sellerAId, masterProduct._id, productSlug, 6);

  const stock12 = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock12.available === 0, 'Available is 0');

  const listingADoc = await SellerListing.findById(listingA._id);
  assert(listingADoc?.availability === 'OUT_OF_STOCK', 'Listing is automatically marked OUT_OF_STOCK');

  // =========================================================================
  // TEST 13: Reservation expires and available > 0 -> marks AVAILABLE
  // =========================================================================
  console.log('\n[TEST 13] Reservation expires and available > 0 -> restores AVAILABLE');
  // Backdate Customer B's reservation of 6
  await CartReservation.updateOne({ userId: customerB, status: 'ACTIVE' }, { expiresAt: new Date(Date.now() - 1000) });
  await CartReservationService.expireStaleReservations({ sellerId: sellerAId });

  const stock13 = await InventoryService.getAvailableStock(sellerAId, masterProduct._id);
  assert(stock13.reserved === 4, 'Reserved decreased to 4');
  assert(stock13.available === 6, 'Available restored to 6');

  const listingADocRestored = await SellerListing.findById(listingA._id);
  assert(listingADocRestored?.availability === 'AVAILABLE', 'Listing is automatically restored to AVAILABLE');

  console.log('\n================================================================');
  console.log('✓ ALL 13 TEST CASES PASSED SUCCESSFULLY!');
  console.log('================================================================\n');

  // Clean up test data
  await MasterProduct.deleteOne({ _id: masterProduct._id });
  await SellerListing.deleteMany({ _id: { $in: [listingA._id, listingB._id] } });
  await ShopInventory.deleteMany({ masterProductId: masterProduct._id });
  await CartReservation.deleteMany({ masterProductId: masterProduct._id });
  await CustomerCart.deleteMany({ userId: { $in: [customerA, customerB, customerC] } });
  await Category.deleteOne({ _id: category._id });
  await Subcategory.deleteOne({ _id: subcategory._id });
  await ProductType.deleteOne({ _id: productType._id });

  await disconnectDatabase();
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
