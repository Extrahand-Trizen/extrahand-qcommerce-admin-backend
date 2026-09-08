import 'dotenv/config';
import http from 'http';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import { SellerPaymentService } from '../services/SellerPaymentService';
import { QcOrderService } from '../services/QcOrderService';
import { signAccessToken } from '../utils/jwt';
import app from '../app';

const TEST_TAG = 'PAY-ISO-TEST';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, failureDetails?: any) {
  if (condition) {
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } else {
    results.push({ name, passed: false, details: failureDetails });
    console.error(`  ✗ FAIL: ${name}`, failureDetails ?? '');
  }
}

async function requestJson(
  serverPort: number,
  path: string,
  token: string,
  method = 'GET',
  body?: any,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 500, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('====================================================');
  console.log('  SHOP-SPECIFIC PAYMENT ISOLATION VERIFICATION SUITE');
  console.log('====================================================\n');

  await connectDatabase();

  // Clean up any previous test runs
  await CustomerOrder.deleteMany({ orderNumber: { $regex: TEST_TAG } });
  await Seller.deleteMany({ userId: { $in: ['iso_user_shop_a', 'iso_user_shop_b'] } });
  await SellerOnboarding.deleteMany({
    businessName: { $in: ['Shop A Isolation Test Store', 'Shop B Isolation Test Store'] },
  });

  // 1. Create Shop A
  const shopA = await Seller.create({
    userId: 'iso_user_shop_a',
    mobileNumber: '919999000001',
    fullName: 'Shopkeeper A',
    status: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  });

  await SellerOnboarding.create({
    sellerId: shopA._id,
    userId: shopA.userId,
    status: 'APPROVED',
    fullName: 'Shopkeeper A',
    shopName: 'Shop A Isolation Test Store',
    mobileNumber: shopA.mobileNumber,
    email: 'shopA@test.com',
    address: '123 Test Market, Madhapur',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500081',
  });

  // 2. Create Shop B
  const shopB = await Seller.create({
    userId: 'iso_user_shop_b',
    mobileNumber: '919999000002',
    fullName: 'Shopkeeper B',
    status: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  });

  await SellerOnboarding.create({
    sellerId: shopB._id,
    userId: shopB.userId,
    status: 'APPROVED',
    fullName: 'Shopkeeper B',
    shopName: 'Shop B Isolation Test Store',
    mobileNumber: shopB.mobileNumber,
    email: 'shopB@test.com',
    address: '456 Test Road, Gachibowli',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500032',
  });

  const shopAId = shopA._id.toString();
  const shopBId = shopB._id.toString();

  console.log(`Created test shops:`);
  console.log(`  Shop A: ID=${shopAId} (User: ${shopA.userId})`);
  console.log(`  Shop B: ID=${shopBId} (User: ${shopB.userId})\n`);

  // 3. Create Order A1 & Payment A1 for Shop A
  const orderA1 = await CustomerOrder.create({
    userId: 'cust_user_1',
    sellerId: shopA._id,
    orderNumber: `${TEST_TAG}-A1-${Date.now()}`,
    shopName: 'Shop A Isolation Test Store',
    status: 'PAID',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'ACCEPTED',
    amountPaise: 45000, // ₹450
    itemTotalPaise: 45000,
    deliveryFeePaise: 0,
    handlingFeePaise: 0,
    couponDiscountPaise: 0,
    partnerTipPaise: 0,
    razorpayOrderId: 'order_rzp_a1',
    razorpayPaymentId: 'pay_a1_iso_unique',
    items: [
      {
        productSlug: 'item-a1',
        masterProductId: new Types.ObjectId(),
        name: 'Item A1',
        unit: '1 kg',
        quantity: 1,
        unitPricePaise: 45000,
        lineTotalPaise: 45000,
      },
    ],
    address: {
      line1: 'Road 1',
      city: 'Hyderabad',
      pinCode: '500081',
      name: 'Customer 1',
      phone: '9000000001',
    },
  });

  // 4. Create Order B1 & Payment B1 for Shop B
  const orderB1 = await CustomerOrder.create({
    userId: 'cust_user_2',
    sellerId: shopB._id,
    orderNumber: `${TEST_TAG}-B1-${Date.now()}`,
    shopName: 'Shop B Isolation Test Store',
    status: 'PAID',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'ACCEPTED',
    amountPaise: 125000, // ₹1,250
    itemTotalPaise: 125000,
    deliveryFeePaise: 0,
    handlingFeePaise: 0,
    couponDiscountPaise: 0,
    partnerTipPaise: 0,
    razorpayOrderId: 'order_rzp_b1',
    razorpayPaymentId: 'pay_b1_iso_unique',
    items: [
      {
        productSlug: 'item-b1',
        masterProductId: new Types.ObjectId(),
        name: 'Item B1',
        unit: '1 pc',
        quantity: 1,
        unitPricePaise: 125000,
        lineTotalPaise: 125000,
      },
    ],
    address: {
      line1: 'Road 2',
      city: 'Hyderabad',
      pinCode: '500081',
      name: 'Customer 2',
      phone: '9000000002',
    },
  });

  console.log(`Created orders:`);
  console.log(`  Order A1: #${orderA1.orderNumber}, Payment: ${orderA1.razorpayPaymentId}, Amount: ₹450`);
  console.log(`  Order B1: #${orderB1.orderNumber}, Payment: ${orderB1.razorpayPaymentId}, Amount: ₹1250\n`);

  // Start HTTP Server on random available port
  const server = http.createServer(app);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as any).port;
  console.log(`Test Express server listening on 127.0.0.1:${port}\n`);

  // Tokens
  const tokenShopA = signAccessToken({ sub: shopA.userId, role: 'SELLER' as any, name: 'Shopkeeper A' });
  const tokenShopB = signAccessToken({ sub: shopB.userId, role: 'SELLER' as any, name: 'Shopkeeper B' });

  // --------------------------------------------------------------------------
  console.log('[SECTION 1] BACKEND SERVICE LAYER ISOLATION');
  // --------------------------------------------------------------------------

  // Test 1: Shop A lists payments
  const paymentsA = await SellerPaymentService.listPayments(shopAId);
  assert(
    paymentsA.items.some((p) => p.paymentId === orderA1.razorpayPaymentId) &&
      !paymentsA.items.some((p) => p.paymentId === orderB1.razorpayPaymentId),
    'Shop A listPayments returns A1 and strictly excludes B1',
  );

  // Test 2: Shop B lists payments
  const paymentsB = await SellerPaymentService.listPayments(shopBId);
  assert(
    paymentsB.items.some((p) => p.paymentId === orderB1.razorpayPaymentId) &&
      !paymentsB.items.some((p) => p.paymentId === orderA1.razorpayPaymentId),
    'Shop B listPayments returns B1 and strictly excludes A1',
  );

  // Test 3: Shop A gets payment A1 by razorpayPaymentId
  const getA1byA = await SellerPaymentService.getPaymentById(shopAId, orderA1.razorpayPaymentId!);
  assert(getA1byA.orderNumber === orderA1.orderNumber, 'Shop A can get its own payment A1');

  // Test 4: Shop A attempts to get payment B1 by razorpayPaymentId -> 403 Forbidden
  let aGotBForbidden = false;
  try {
    await SellerPaymentService.getPaymentById(shopAId, orderB1.razorpayPaymentId!);
  } catch (err: any) {
    if (err.statusCode === 403) aGotBForbidden = true;
  }
  assert(aGotBForbidden, 'Shop A getPaymentById(B1) throws 403 Forbidden');

  // Test 5: Shop B attempts to get payment A1 by razorpayPaymentId -> 403 Forbidden
  let bGotAForbidden = false;
  try {
    await SellerPaymentService.getPaymentById(shopBId, orderA1.razorpayPaymentId!);
  } catch (err: any) {
    if (err.statusCode === 403) bGotAForbidden = true;
  }
  assert(bGotAForbidden, 'Shop B getPaymentById(A1) throws 403 Forbidden');

  // Test 6: Revenue calculations isolated
  const revA = await SellerPaymentService.getRevenueAnalytics(shopAId);
  const revB = await SellerPaymentService.getRevenueAnalytics(shopBId);
  assert(
    revA.totalRevenuePaise === 45000 && revA.completedPaymentsCount === 1,
    `Shop A revenue sums only A1 (Expected 45000, got ${revA.totalRevenuePaise})`,
  );
  assert(
    revB.totalRevenuePaise === 125000 && revB.completedPaymentsCount === 1,
    `Shop B revenue sums only B1 (Expected 125000, got ${revB.totalRevenuePaise})`,
  );

  // Test 7: Order access control in QcOrderService
  let aGotOrderBForbidden = false;
  try {
    await QcOrderService.getSellerOrder(shopAId, orderB1._id.toString());
  } catch (err: any) {
    if (err.statusCode === 403) aGotOrderBForbidden = true;
  }
  assert(aGotOrderBForbidden, 'Shop A getSellerOrder(orderB1) throws 403 Forbidden');

  // --------------------------------------------------------------------------
  console.log('\n[SECTION 2] HTTP API ENDPOINT SECURITY & TAMPER RESISTANCE');
  // --------------------------------------------------------------------------

  // Test 8: HTTP GET /api/v1/seller/payments as Shop A
  const httpListA = await requestJson(port, '/api/v1/seller/payments', tokenShopA);
  assert(
    httpListA.status === 200 &&
      httpListA.body.data.items.some((p: any) => p.paymentId === orderA1.razorpayPaymentId) &&
      !httpListA.body.data.items.some((p: any) => p.paymentId === orderB1.razorpayPaymentId),
    'HTTP GET /api/v1/seller/payments as Shop A returns only Shop A payments',
    httpListA.body,
  );

  // Test 9: HTTP GET /api/v1/seller/payments as Shop B
  const httpListB = await requestJson(port, '/api/v1/seller/payments', tokenShopB);
  assert(
    httpListB.status === 200 &&
      httpListB.body.data.items.some((p: any) => p.paymentId === orderB1.razorpayPaymentId) &&
      !httpListB.body.data.items.some((p: any) => p.paymentId === orderA1.razorpayPaymentId),
    'HTTP GET /api/v1/seller/payments as Shop B returns only Shop B payments',
    httpListB.body,
  );

  // Test 10: Shop A calls GET /api/v1/seller/payments/:paymentB1Id -> 403 Forbidden
  const httpGetB1asA = await requestJson(
    port,
    `/api/v1/seller/payments/${orderB1.razorpayPaymentId}`,
    tokenShopA,
  );
  assert(
    httpGetB1asA.status === 403,
    `HTTP GET /api/v1/seller/payments/:b1 as Shop A returns 403 Forbidden (got ${httpGetB1asA.status})`,
    httpGetB1asA.body,
  );

  // Test 11: Shop B calls GET /api/v1/seller/payments/:paymentA1Id -> 403 Forbidden
  const httpGetA1asB = await requestJson(
    port,
    `/api/v1/seller/payments/${orderA1.razorpayPaymentId}`,
    tokenShopB,
  );
  assert(
    httpGetA1asB.status === 403,
    `HTTP GET /api/v1/seller/payments/:a1 as Shop B returns 403 Forbidden (got ${httpGetA1asB.status})`,
    httpGetA1asB.body,
  );

  // Test 12: Direct route alias GET /api/v1/payments/:paymentB1Id as Shop A -> 403 Forbidden
  const httpDirectAliasB1asA = await requestJson(
    port,
    `/api/v1/payments/${orderB1.razorpayPaymentId}`,
    tokenShopA,
  );
  assert(
    httpDirectAliasB1asA.status === 403,
    `HTTP GET /api/v1/payments/:b1 as Shop A returns 403 Forbidden (got ${httpDirectAliasB1asA.status})`,
    httpDirectAliasB1asA.body,
  );

  // Test 13: Query tampering attempt: Shop A sends ?storeId=<ShopBId> -> 403 Forbidden
  const httpTamperStoreId = await requestJson(
    port,
    `/api/v1/seller/payments?storeId=${shopBId}`,
    tokenShopA,
  );
  assert(
    httpTamperStoreId.status === 403,
    `HTTP Tampering: Shop A passing ?storeId=ShopB rejected with 403 Forbidden (got ${httpTamperStoreId.status})`,
    httpTamperStoreId.body,
  );

  // Test 14: Query tampering attempt on revenue: Shop A sends ?sellerId=<ShopBId> -> 403 Forbidden
  const httpTamperRevenue = await requestJson(
    port,
    `/api/v1/seller/revenue?sellerId=${shopBId}`,
    tokenShopA,
  );
  assert(
    httpTamperRevenue.status === 403,
    `HTTP Tampering: Shop A passing ?sellerId=ShopB on revenue rejected with 403 Forbidden (got ${httpTamperRevenue.status})`,
    httpTamperRevenue.body,
  );

  // Test 15: HTTP GET /api/v1/seller/revenue as Shop A
  const httpRevA = await requestJson(port, '/api/v1/seller/revenue', tokenShopA);
  assert(
    httpRevA.status === 200 && httpRevA.body.data.totalRevenuePaise === 45000,
    `HTTP GET /api/v1/seller/revenue as Shop A returns exactly ₹450 (got ₹${httpRevA.body.data?.totalRevenuePaise / 100})`,
    httpRevA.body,
  );

  // Test 16: HTTP GET /api/v1/seller/revenue as Shop B
  const httpRevB = await requestJson(port, '/api/v1/seller/revenue', tokenShopB);
  assert(
    httpRevB.status === 200 && httpRevB.body.data.totalRevenuePaise === 125000,
    `HTTP GET /api/v1/seller/revenue as Shop B returns exactly ₹1,250 (got ₹${httpRevB.body.data?.totalRevenuePaise / 100})`,
    httpRevB.body,
  );

  // Test 17: HTTP GET /api/v1/seller/orders/:orderB1Id as Shop A -> 403 Forbidden
  const httpOrderB1asA = await requestJson(
    port,
    `/api/v1/seller/orders/${orderB1._id.toString()}`,
    tokenShopA,
  );
  assert(
    httpOrderB1asA.status === 403,
    `HTTP GET /api/v1/seller/orders/:orderB1 as Shop A returns 403 Forbidden (got ${httpOrderB1asA.status})`,
    httpOrderB1asA.body,
  );

  // Test 18: HTTP GET /api/v1/seller/settlements as Shop A
  const httpSettlementsA = await requestJson(port, '/api/v1/seller/settlements', tokenShopA);
  assert(
    httpSettlementsA.status === 200 &&
      httpSettlementsA.body.data.settlements.length === 1 &&
      httpSettlementsA.body.data.settlements[0].orderNumber === orderA1.orderNumber,
    'HTTP GET /api/v1/seller/settlements as Shop A returns only Shop A settlements',
    httpSettlementsA.body,
  );

  // Test 19: HTTP GET /api/v1/seller/transactions as Shop A
  const httpTxnsA = await requestJson(port, '/api/v1/seller/transactions', tokenShopA);
  assert(
    httpTxnsA.status === 200 &&
      httpTxnsA.body.data.items.length === 1 &&
      httpTxnsA.body.data.items[0].orderNumber === orderA1.orderNumber,
    'HTTP GET /api/v1/seller/transactions as Shop A returns only Shop A transactions',
    httpTxnsA.body,
  );

  // Cleanup
  server.close();
  await CustomerOrder.deleteMany({ orderNumber: { $regex: TEST_TAG } });
  await Seller.deleteMany({ userId: { $in: ['iso_user_shop_a', 'iso_user_shop_b'] } });
  await SellerOnboarding.deleteMany({
    businessName: { $in: ['Shop A Isolation Test Store', 'Shop B Isolation Test Store'] },
  });

  await disconnectDatabase();

  console.log('\n====================================================');
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) {
    console.log(`  ALL ${results.length} SHOP-SPECIFIC PAYMENT ISOLATION TESTS PASSED!`);
    console.log('====================================================\n');
    process.exit(0);
  } else {
    console.error(`  ${failed.length} OF ${results.length} TESTS FAILED!`);
    console.log('====================================================\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
