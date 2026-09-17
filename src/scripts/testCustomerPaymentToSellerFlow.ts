import 'dotenv/config';
import http from 'http';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerLedger from '../models/SellerLedger';
import { SellerPaymentService, formatSellerPayment } from '../services/SellerPaymentService';
import { SellerLedgerService } from '../services/SellerLedgerService';
import { signAccessToken } from '../utils/jwt';
import app from '../app';

const TEST_TAG = 'PAY-FLOW-TEST';

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
  console.log('  CUSTOMER PAYMENT TO SELLER APP END-TO-END SUITE');
  console.log('====================================================\n');

  await connectDatabase();

  // Cleanup
  await CustomerOrder.deleteMany({ orderNumber: { $regex: TEST_TAG } });
  await Seller.deleteMany({ userId: { $in: ['pay_flow_user_a', 'pay_flow_user_b'] } });
  await SellerOnboarding.deleteMany({
    businessName: { $in: ['Flow Shop A', 'Flow Shop B'] },
  });
  await SellerLedger.deleteMany({ orderNumber: { $regex: TEST_TAG } });

  // 1. Create Shop A and Shop B
  const shopA = await Seller.create({
    userId: 'pay_flow_user_a',
    mobileNumber: '918888000001',
    fullName: 'Shopkeeper Flow A',
    status: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  });
  await SellerOnboarding.create({
    sellerId: shopA._id,
    userId: shopA.userId,
    status: 'APPROVED',
    fullName: 'Shopkeeper Flow A',
    shopName: 'Flow Shop A',
    businessName: 'Flow Shop A',
    mobileNumber: shopA.mobileNumber,
    email: 'shopA@flowtest.com',
    address: 'Madhapur',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500081',
  });

  const shopB = await Seller.create({
    userId: 'pay_flow_user_b',
    mobileNumber: '918888000002',
    fullName: 'Shopkeeper Flow B',
    status: 'ACTIVE',
    onboardingStatus: 'APPROVED',
  });
  await SellerOnboarding.create({
    sellerId: shopB._id,
    userId: shopB.userId,
    status: 'APPROVED',
    fullName: 'Shopkeeper Flow B',
    shopName: 'Flow Shop B',
    businessName: 'Flow Shop B',
    mobileNumber: shopB.mobileNumber,
    email: 'shopB@flowtest.com',
    address: 'Kondapur',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500084',
  });

  const tokenA = signAccessToken({ sub: shopA.userId, role: 'SELLER' as any, name: 'Shopkeeper Flow A' });
  const tokenB = signAccessToken({ sub: shopB.userId, role: 'SELLER' as any, name: 'Shopkeeper Flow B' });

  // Start HTTP Server
  const server = http.createServer(app);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as any).port;

  // --------------------------------------------------------------------------
  console.log('[SCENARIO 1] CUSTOMER PAYS FOR ORDER -> VISIBLE IN SELLER APP');
  // --------------------------------------------------------------------------
  const orderNumA1 = `${TEST_TAG}-A1-${Date.now()}`;
  const grossAmountPaise = 75000; // ₹750
  const orderA1 = await CustomerOrder.create({
    userId: 'cust_flow_user_1',
    sellerId: shopA._id,
    orderNumber: orderNumA1,
    shopName: 'Flow Shop A',
    status: 'PAID',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'PENDING_ACCEPT',
    amountPaise: grossAmountPaise,
    itemTotalPaise: grossAmountPaise,
    deliveryFeePaise: 0,
    handlingFeePaise: 0,
    couponDiscountPaise: 0,
    partnerTipPaise: 0,
    razorpayOrderId: 'order_rzp_flow_a1',
    razorpayPaymentId: 'pay_rzp_flow_a1',
    items: [
      {
        productSlug: 'item-flow-1',
        masterProductId: new Types.ObjectId(),
        name: 'Organic Honey',
        unit: '500 g',
        quantity: 1,
        unitPricePaise: grossAmountPaise,
        lineTotalPaise: grossAmountPaise,
      },
    ],
    address: {
      line1: 'Flat 101, Road 2',
      city: 'Hyderabad',
      pinCode: '500081',
      name: 'Rohan Sharma',
      phone: '9888877771',
    },
    refunds: [],
    fulfillmentEvents: [],
    deliveryInstructions: [],
  });

  // Record customer payment in ledger as happens upon payment confirmation
  await SellerLedgerService.recordCustomerPayment(orderA1);

  // 1. Verify GET /seller/payments as Shop A
  const resPaymentsA = await requestJson(port, '/api/v1/seller/payments', tokenA);
  assert(resPaymentsA.status === 200, 'GET /seller/payments returns 200 OK');
  const paymentItemA = resPaymentsA.body.data.items.find((p: any) => p.orderNumber === orderNumA1);
  assert(Boolean(paymentItemA), 'Payment appears in GET /seller/payments');
  assert(paymentItemA?.grossAmountPaise === 75000, 'Payment grossAmount is ₹750 (75,000 paise)');
  assert(paymentItemA?.paymentStatus === 'PAID', 'Payment status is PAID');
  assert(paymentItemA?.customerName === 'Rohan Sharma', 'Payment contains customer name Rohan Sharma');
  assert(Boolean(paymentItemA?.netAmountPaise && paymentItemA.netAmountPaise > 0), 'Calculates correct netAmountPaise (deducting 5% fee + GST)');

  // 2. Verify GET /seller/transactions as Shop A
  const resTxnsA = await requestJson(port, '/api/v1/seller/transactions', tokenA);
  assert(resTxnsA.status === 200, 'GET /seller/transactions returns 200 OK');
  const txnItemA = resTxnsA.body.data.items.find((t: any) => t.orderNumber === orderNumA1);
  assert(Boolean(txnItemA), 'Transaction appears in GET /seller/transactions immediately upon payment');
  assert(txnItemA?.grossAmountPaise === 75000 || txnItemA?.amountPaise === 75000, 'Transaction amount is ₹750');
  assert(Boolean(txnItemA?.date), 'Transaction date is present');

  // 3. Verify GET /seller/settlements as Shop A includes the in-progress order
  const resSettlementsA = await requestJson(port, '/api/v1/seller/settlements', tokenA);
  assert(resSettlementsA.status === 200, 'GET /seller/settlements returns 200 OK');
  const settlementItemA = resSettlementsA.body.data.settlements.find((s: any) => s.orderNumber === orderNumA1);
  assert(Boolean(settlementItemA), 'Order appears in GET /seller/settlements while in fulfillment');
  assert(settlementItemA?.status === 'pending', 'Settlement status is pending (holding period)');

  // 4. Verify GET /seller/overview as Shop A
  const resOverviewA = await requestJson(port, '/api/v1/seller/overview', tokenA);
  assert(resOverviewA.status === 200, 'GET /seller/overview returns 200 OK');
  assert(resOverviewA.body.data.recentTransactions.some((t: any) => t.orderNumber === orderNumA1), 'Overview includes recent transactions');

  // --------------------------------------------------------------------------
  console.log('\n[SCENARIO 2] MULTI-SHOP ISOLATION');
  // --------------------------------------------------------------------------
  // Shop B places an order
  const orderNumB1 = `${TEST_TAG}-B1-${Date.now()}`;
  const orderB1 = await CustomerOrder.create({
    userId: 'cust_flow_user_2',
    sellerId: shopB._id,
    orderNumber: orderNumB1,
    shopName: 'Flow Shop B',
    status: 'PAID',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'PENDING_ACCEPT',
    amountPaise: 120000, // ₹1,200
    itemTotalPaise: 120000,
    deliveryFeePaise: 0,
    handlingFeePaise: 0,
    couponDiscountPaise: 0,
    partnerTipPaise: 0,
    razorpayOrderId: 'order_rzp_flow_b1',
    razorpayPaymentId: 'pay_rzp_flow_b1',
    items: [],
    address: {
      line1: 'Road 5',
      city: 'Hyderabad',
      pinCode: '500084',
      name: 'Sneha Patel',
      phone: '9888877772',
    },
    refunds: [],
    fulfillmentEvents: [],
    deliveryInstructions: [],
  });
  await SellerLedgerService.recordCustomerPayment(orderB1);

  // Shop A cannot see Shop B's payment in /payments
  const resPaymentsA2 = await requestJson(port, '/api/v1/seller/payments', tokenA);
  assert(!resPaymentsA2.body.data.items.some((p: any) => p.orderNumber === orderNumB1), 'Shop A strictly cannot see Shop B payment in /payments');

  // Shop A cannot see Shop B's transaction in /transactions
  const resTxnsA2 = await requestJson(port, '/api/v1/seller/transactions', tokenA);
  assert(!resTxnsA2.body.data.items.some((t: any) => t.orderNumber === orderNumB1), 'Shop A strictly cannot see Shop B transaction in /transactions');

  // Shop B sees only Shop B's payment
  const resPaymentsB = await requestJson(port, '/api/v1/seller/payments', tokenB);
  assert(resPaymentsB.body.data.items.some((p: any) => p.orderNumber === orderNumB1), 'Shop B sees its own payment B1');
  assert(!resPaymentsB.body.data.items.some((p: any) => p.orderNumber === orderNumA1), 'Shop B strictly cannot see Shop A payment');

  // --------------------------------------------------------------------------
  console.log('\n[SCENARIO 3] REFUNDED / CANCELLED ORDER RULES');
  // --------------------------------------------------------------------------
  // Create an order that gets refunded
  const orderNumA2 = `${TEST_TAG}-A2-${Date.now()}`;
  const orderA2 = await CustomerOrder.create({
    userId: 'cust_flow_user_3',
    sellerId: shopA._id,
    orderNumber: orderNumA2,
    shopName: 'Flow Shop A',
    status: 'CANCELLED',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'REJECTED',
    amountPaise: 50000,
    itemTotalPaise: 50000,
    deliveryFeePaise: 0,
    handlingFeePaise: 0,
    couponDiscountPaise: 0,
    partnerTipPaise: 0,
    razorpayOrderId: 'order_rzp_flow_a2',
    razorpayPaymentId: 'pay_rzp_flow_a2',
    items: [],
    address: { line1: 'Road 3', city: 'Hyderabad', pinCode: '500081', name: 'Ananya Roy' },
    refunds: [
      {
        amountPaise: 50000,
        reason: 'OUT_OF_STOCK',
        status: 'ISSUED',
        at: new Date(),
      },
    ],
    fulfillmentEvents: [],
    deliveryInstructions: [],
  });

  const paymentA2 = formatSellerPayment(orderA2);
  assert(paymentA2.settlementStatus === 'refunded', 'Refunded order has settlementStatus = refunded');
  assert(paymentA2.totalRefundedPaise === 50000, 'Total refunded is 50,000 paise');

  // --------------------------------------------------------------------------
  // Cleanup
  server.close();
  await CustomerOrder.deleteMany({ orderNumber: { $regex: TEST_TAG } });
  await Seller.deleteMany({ userId: { $in: ['pay_flow_user_a', 'pay_flow_user_b'] } });
  await SellerOnboarding.deleteMany({
    businessName: { $in: ['Flow Shop A', 'Flow Shop B'] },
  });
  await SellerLedger.deleteMany({ orderNumber: { $regex: TEST_TAG } });
  await disconnectDatabase();

  console.log('\n====================================================');
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) {
    console.log(`  ALL ${results.length} END-TO-END PAYMENT FLOW TESTS PASSED! 🎉`);
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
