import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import mongoose, { Types } from 'mongoose';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import { QcOrderService } from '../services/QcOrderService';
import assert from 'node:assert';

async function main() {
  await connectDatabase();
  console.log('================================================================');
  console.log('       PARTNER PROFILE SNAPSHOT BYPASS TEST SUITE               ');
  console.log('================================================================');

  const seller = await Seller.findOne({ status: 'ACTIVE' }) || await Seller.findOne();
  if (!seller) throw new Error('No seller found');
  const sellerId = seller._id.toString();

  const testOrderIds: Types.ObjectId[] = [];

  // Track global fetch calls
  const originalFetch = global.fetch;
  let fetchCalls: string[] = [];
  global.fetch = (async (url: any, init: any) => {
    fetchCalls.push(String(url));
    if (String(url).includes('/api/v1/profiles/internal/')) {
      return {
        ok: true,
        json: async () => ({
          profile: {
            name: 'Fetched Partner From User Service',
            phone: '9988776655',
          },
        }),
      } as any;
    }
    return originalFetch(url, init);
  }) as any;

  try {
    const partnerUid = 'test-partner-uid-' + Date.now();

    // Case 1: Partner snapshot completely exists in order
    const o1 = await CustomerOrder.create({
      orderNumber: 'TEST-PARTNER-01',
      userId: 'test-user-1',
      sellerId: new Types.ObjectId(sellerId),
      paymentStatus: 'PAID',
      fulfillmentStatus: 'HANDED_OVER',
      partnerUid,
      partnerName: 'Snapshot Partner Name',
      partnerPhone: '9876543210',
      amountPaise: 5000,
      itemTotalPaise: 5000,
      items: [{ productSlug: 'item-1', name: 'Item 1', quantity: 1, unitPricePaise: 5000, lineTotalPaise: 5000 }],
    });
    testOrderIds.push(o1._id);

    // Case 2: Partner snapshot partially exists (missing phone)
    const o2 = await CustomerOrder.create({
      orderNumber: 'TEST-PARTNER-02',
      userId: 'test-user-2',
      sellerId: new Types.ObjectId(sellerId),
      paymentStatus: 'PAID',
      fulfillmentStatus: 'HANDED_OVER',
      partnerUid: partnerUid + '-partial',
      partnerName: 'Partial Partner',
      partnerPhone: null,
      amountPaise: 5000,
      itemTotalPaise: 5000,
      items: [{ productSlug: 'item-2', name: 'Item 2', quantity: 1, unitPricePaise: 5000, lineTotalPaise: 5000 }],
    });
    testOrderIds.push(o2._id);

    // Case 3: Partner snapshot does not exist (both missing)
    const o3 = await CustomerOrder.create({
      orderNumber: 'TEST-PARTNER-03',
      userId: 'test-user-3',
      sellerId: new Types.ObjectId(sellerId),
      paymentStatus: 'PAID',
      fulfillmentStatus: 'HANDED_OVER',
      partnerUid: partnerUid + '-none',
      partnerName: null,
      partnerPhone: null,
      amountPaise: 5000,
      itemTotalPaise: 5000,
      items: [{ productSlug: 'item-3', name: 'Item 3', quantity: 1, unitPricePaise: 5000, lineTotalPaise: 5000 }],
    });
    testOrderIds.push(o3._id);

    // Test Case 1 Isolation:
    fetchCalls = [];
    const ordersCase1 = await QcOrderService.listSellerOrders(sellerId);
    const found1 = ordersCase1.items.find((i) => i.id === o1._id.toString());
    assert(found1, 'Order 1 found');
    assert.strictEqual(found1.partnerName, 'Snapshot Partner Name');
    assert.strictEqual(found1.partnerPhone, '9876543210');

    const internalCallsForO1 = fetchCalls.filter((url) => url.includes(partnerUid) && !url.includes('-partial') && !url.includes('-none'));
    console.log(`Case 1 (Snapshot exists): HTTP user-service calls made for o1 = ${internalCallsForO1.length}`);
    assert.strictEqual(internalCallsForO1.length, 0, 'Case 1 must NOT call user-service when snapshot exists');
    console.log('✅ Case 1 PASSED: External HTTP call completely bypassed when snapshot exists.\n');

    // Test Case 2 & 3:
    const partialCall = fetchCalls.some((url) => url.includes(partnerUid + '-partial'));
    const noneCall = fetchCalls.some((url) => url.includes(partnerUid + '-none'));
    console.log(`Case 2 (Partial snapshot): HTTP call made = ${partialCall}`);
    console.log(`Case 3 (No snapshot): HTTP call made = ${noneCall}`);
    assert.strictEqual(partialCall, true, 'Case 2 must call user-service when phone is missing');
    assert.strictEqual(noneCall, true, 'Case 3 must call user-service when both are missing');
    console.log('✅ Case 2 & 3 PASSED: External HTTP call made when required partner information is missing.\n');

    // Test Case 4: User service unavailable
    global.fetch = (async (url: any) => {
      if (String(url).includes('/api/v1/profiles/internal/')) {
        throw new Error('ECONNREFUSED: User service down');
      }
      return originalFetch(url);
    }) as any;

    const ordersCase4 = await QcOrderService.listSellerOrders(sellerId);
    const found3 = ordersCase4.items.find((i) => i.id === o3._id.toString());
    assert(found3, 'Order 3 found even when user-service is down');
    console.log('✅ Case 4 PASSED: Graceful fallback when user-service is down without crashing API.\n');

    console.log('================================================================');
    console.log('   ALL 4 PARTNER SNAPSHOT BYPASS TESTS PASSED                  ');
    console.log('================================================================');

  } finally {
    global.fetch = originalFetch;
    if (testOrderIds.length) {
      await CustomerOrder.deleteMany({ _id: { $in: testOrderIds } });
    }
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
