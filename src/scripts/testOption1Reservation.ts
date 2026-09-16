import mongoose, { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerListing from '../models/SellerListing';
import ShopInventory from '../models/ShopInventory';
import MasterProduct from '../models/MasterProduct';
import CustomerCart from '../models/CustomerCart';
import CustomerOrder from '../models/CustomerOrder';
import SellerStoreSettings from '../models/SellerStoreSettings';
import SellerOnboarding from '../models/SellerOnboarding';
import { CustomerStoreService } from '../services/CustomerStoreService';
import { QcOrderService } from '../services/QcOrderService';
import { InventoryService } from '../services/InventoryService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ PASS: ${message}`);
}

async function run() {
  console.log('\n=============================================');
  console.log('Testing Option 1: Reservation at Payment Checkout');
  console.log('=============================================\n');

  await connectDatabase();

  const ts = Date.now();
  const testUserIdA = `test-user-a-${ts}`;
  const testUserIdB = `test-user-b-${ts}`;

  // 1. Create a test seller
  const seller = await Seller.create({
    userId: `seller-user-${ts}`,
    fullName: `Option1 Test Seller ${ts}`,
    mobileNumber: `9${String(ts).slice(-9)}`,
    status: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  });
  const sellerId = seller._id;

  await SellerOnboarding.create({
    sellerId,
    fullName: `Option1 Test Seller ${ts}`,
    mobileNumber: `9${String(ts).slice(-9)}`,
    shopName: `Option1 Shop ${ts}`,
    address: '123 Test St',
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560001',
    status: 'APPROVED',
  });

  await SellerStoreSettings.create({
    sellerId,
    storeStatus: 'OPEN',
    statusMode: 'MANUAL',
    openTime: '08:00',
    closeTime: '22:00',
    daysOpen: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  });

  // 2. Create a test master product
  const productSlug = `test-product-${ts}`;
  const masterProduct = await MasterProduct.create({
    categoryId: new Types.ObjectId(),
    subcategoryId: new Types.ObjectId(),
    productTypeId: new Types.ObjectId(),
    sku: `SKU-${ts}`,
    name: `Option1 Test Product ${ts}`,
    slug: productSlug,
    sellingPricePaise: 10000,
    status: 'ACTIVE',
  });

  // 3. Create listing with 2 stock, 0 reserved
  const listing = await SellerListing.create({
    sellerId,
    masterProductId: masterProduct._id,
    sellingPricePaise: 10000,
    compareAtPricePaise: 10000,
    stock: 2,
    reserved: 0,
    availability: 'AVAILABLE',
    status: 'ACTIVE',
    reviewStatus: 'APPROVED',
  });

  await ShopInventory.create({
    sellerId,
    listingId: listing._id,
    masterProductId: masterProduct._id,
    stock: 2,
    reserved: 0,
  });

  console.log('Step 1: Setup completed with 2 units in stock.');

  // Verify initial stock
  let stockInfo = await InventoryService.getAvailableStock(sellerId, masterProduct._id);
  assert(stockInfo.stock === 2 && stockInfo.reserved === 0 && stockInfo.available === 2, 'Initial stock is 2, reserved is 0, available is 2');

  // Step 2: Customer A adds 2 units to cart
  console.log('\n--- Step 2: Customer A adds 2 units to cart ---');
  await CustomerStoreService.upsertCartItem(testUserIdA, { productSlug, quantity: 2 }, { sellerId: sellerId.toString() });

  stockInfo = await InventoryService.getAvailableStock(sellerId, masterProduct._id);
  assert(stockInfo.reserved === 0, 'Adding to cart does NOT reserve stock (reserved is still 0)');
  assert(stockInfo.available === 2, 'Available stock remains 2');

  // Step 3: Customer B also adds 2 units to cart (not blocked!)
  console.log('\n--- Step 3: Customer B adds 2 units of the same item to cart ---');
  await CustomerStoreService.upsertCartItem(testUserIdB, { productSlug, quantity: 2 }, { sellerId: sellerId.toString() });

  stockInfo = await InventoryService.getAvailableStock(sellerId, masterProduct._id);
  assert(stockInfo.reserved === 0, 'Customer B can also add to cart without reservation (reserved is still 0)');
  assert(stockInfo.available === 2, 'Available stock remains 2 for both users');

  // Step 4: Customer A proceeds to pay / checkout
  console.log('\n--- Step 4: Customer A clicks Payout / Checkout ---');
  const dummyAddress = {
    line1: '123 Main St',
    city: 'Bangalore',
    state: 'Karnataka',
    pinCode: '560001',
    coordinates: [77.5946, 12.9716] as [number, number],
  };

  const checkoutResultA = await QcOrderService.checkout(
    testUserIdA,
    { address: dummyAddress },
    { sellerId: sellerId.toString() },
  );

  const orderA = checkoutResultA.order;
  assert(orderA.status === 'PENDING_PAYMENT', 'Customer A order created with status PENDING_PAYMENT');
  const dbOrderA = await CustomerOrder.findById(orderA.id).lean();
  assert(dbOrderA?.reservationStatus === 'RESERVED', 'Customer A order reservationStatus is RESERVED');

  stockInfo = await InventoryService.getAvailableStock(sellerId, masterProduct._id);
  assert(stockInfo.reserved === 2, 'Checkout reserved 2 units during payment window (reserved is 2)');
  assert(stockInfo.available === 0, 'Available stock is now 0');

  const refreshedListing = await SellerListing.findById(listing._id).lean();
  assert(refreshedListing?.availability === 'OUT_OF_STOCK', 'Listing is marked OUT_OF_STOCK when available reaches 0');

  // Step 5: Customer B tries to checkout while Customer A is in payment window
  console.log('\n--- Step 5: Customer B attempts checkout while stock is reserved ---');
  let customerBCheckoutFailed = false;
  try {
    await QcOrderService.checkout(
      testUserIdB,
      { address: dummyAddress },
      { sellerId: sellerId.toString() },
    );
  } catch (err: any) {
    customerBCheckoutFailed = true;
    console.log(`  Customer B checkout blocked as expected: "${err.message}" (HTTP ${err.statusCode})`);
    assert(err.statusCode === 409, 'Customer B checkout blocked with 409 Conflict');
  }
  assert(customerBCheckoutFailed, 'Customer B checkout was prevented because stock is reserved');

  // Step 6: Customer A abandons payment / payment fails
  console.log('\n--- Step 6: Customer A abandons payment ---');
  await QcOrderService.abandon(testUserIdA, orderA.id);

  const abandonedOrder = await CustomerOrder.findById(orderA.id).lean();
  assert(abandonedOrder?.status === 'CANCELLED', 'Order A marked CANCELLED');
  assert(abandonedOrder?.reservationStatus === 'RELEASED', 'Order A reservationStatus changed to RELEASED');

  stockInfo = await InventoryService.getAvailableStock(sellerId, masterProduct._id);
  assert(stockInfo.reserved === 0, 'Reserved stock released back to 0 on abandon');
  assert(stockInfo.available === 2, 'Available stock restored to 2');

  const listingAfterAbandon = await SellerListing.findById(listing._id).lean();
  assert(listingAfterAbandon?.availability === 'AVAILABLE', 'Listing availability restored to AVAILABLE');

  // Step 7: Customer B now checkouts successfully
  console.log('\n--- Step 7: Customer B checkouts now that stock is released ---');
  const checkoutResultB = await QcOrderService.checkout(
    testUserIdB,
    { address: dummyAddress },
    { sellerId: sellerId.toString() },
  );
  const orderB = checkoutResultB.order;
  assert(orderB.status === 'PENDING_PAYMENT', 'Customer B order created successfully');
  const dbOrderB = await CustomerOrder.findById(orderB.id).lean();
  assert(dbOrderB?.reservationStatus === 'RESERVED', 'Customer B order reserved');

  stockInfo = await InventoryService.getAvailableStock(sellerId, masterProduct._id);
  assert(stockInfo.reserved === 2, 'Stock reserved for Customer B');
  assert(stockInfo.available === 0, 'Available stock is 0 again');

  // Step 8: Test stale pending payment sweeper
  console.log('\n--- Step 8: Test Stale Pending Payment Sweeper ---');
  // Backdate orderB's createdAt to 15 minutes ago
  await CustomerOrder.findByIdAndUpdate(orderB.id, {
    createdAt: new Date(Date.now() - 15 * 60_000),
  });

  const sweptCount = await QcOrderService.expireStalePendingPayments(10);
  assert(sweptCount >= 1, `Sweeper caught and expired ${sweptCount} stale pending payment order(s)`);

  const expiredOrderB = await CustomerOrder.findById(orderB.id).lean();
  assert(expiredOrderB?.status === 'CANCELLED', 'Stale order cancelled by sweeper');
  assert(expiredOrderB?.reservationStatus === 'RELEASED', 'Stale order reservationStatus released by sweeper');

  stockInfo = await InventoryService.getAvailableStock(sellerId, masterProduct._id);
  assert(stockInfo.reserved === 0, 'Sweeper restored reserved count back to 0');
  assert(stockInfo.available === 2, 'Sweeper restored available stock back to 2');

  const listingAfterSweep = await SellerListing.findById(listing._id).lean();
  assert(listingAfterSweep?.availability === 'AVAILABLE', 'Listing availability restored to AVAILABLE by sweeper');

  // Clean up test data
  console.log('\n--- Cleaning up test records ---');
  await CustomerOrder.deleteMany({ _id: { $in: [orderA.id, orderB.id] } });
  await CustomerCart.deleteMany({ userId: { $in: [testUserIdA, testUserIdB] } });
  await SellerListing.deleteOne({ _id: listing._id });
  await ShopInventory.deleteOne({ listingId: listing._id });
  await MasterProduct.deleteOne({ _id: masterProduct._id });
  await SellerStoreSettings.deleteOne({ sellerId });
  await SellerOnboarding.deleteOne({ sellerId });
  await Seller.deleteOne({ _id: sellerId });

  console.log('\n=============================================');
  console.log('All Option 1 stock reservation tests PASSED! 🎉');
  console.log('=============================================\n');

  await disconnectDatabase();
}

run().catch(async (err) => {
  console.error('Test execution failed:', err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
