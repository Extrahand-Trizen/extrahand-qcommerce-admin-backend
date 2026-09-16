import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import * as UserServiceClient from '../services/UserServiceClient';
import { QcOrderService } from '../services/QcOrderService';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import { Types } from 'mongoose';

async function runPartnerBypassTests() {
  await connectDatabase();
  console.log('--- Starting Partner Profile Snapshot Bypass Tests ---');

  let fetchCallCount = 0;
  const originalFetchPartnerProfile = UserServiceClient.fetchPartnerProfile;

  // Spy on fetchPartnerProfile
  (UserServiceClient as any).fetchPartnerProfile = async (uid: string) => {
    fetchCallCount++;
    if (uid === 'UNAVAILABLE_UID') {
      throw new Error('Service Unavailable 503');
    }
    return { name: 'Fetched Partner', phone: '+919999999999' };
  };

  const seller = await Seller.findOne({});
  const sellerId = String(seller?._id || new Types.ObjectId());

  const dummyAddress = {
    line1: '123 Test St',
    city: 'Bangalore',
    state: 'Karnataka',
    pinCode: '560001',
    name: 'Test Customer',
    phone: '+919876543210',
  };

  const mockOrders = [
    // Case 1: Full snapshot present
    {
      userId: 'test-user-1',
      sellerId: new Types.ObjectId(sellerId),
      orderNumber: 'QC-TEST-PARTNER-1',
      fulfillmentStatus: 'HANDED_OVER',
      paymentStatus: 'PAID',
      amountPaise: 50000,
      itemTotalPaise: 50000,
      deliveryFeePaise: 0,
      handlingFeePaise: 0,
      partnerTipPaise: 0,
      couponDiscountPaise: 0,
      address: dummyAddress,
      partnerUid: 'partner-uid-1',
      partnerName: 'Snapshot Name 1',
      partnerPhone: '+911111111111',
      items: [],
      createdAt: new Date(),
    },
    // Case 2: Partial snapshot present (phone missing)
    {
      userId: 'test-user-2',
      sellerId: new Types.ObjectId(sellerId),
      orderNumber: 'QC-TEST-PARTNER-2',
      fulfillmentStatus: 'HANDED_OVER',
      paymentStatus: 'PAID',
      amountPaise: 50000,
      itemTotalPaise: 50000,
      deliveryFeePaise: 0,
      handlingFeePaise: 0,
      partnerTipPaise: 0,
      couponDiscountPaise: 0,
      address: dummyAddress,
      partnerUid: 'partner-uid-2',
      partnerName: 'Snapshot Name 2',
      partnerPhone: null,
      items: [],
      createdAt: new Date(),
    },
    // Case 3: No snapshot present
    {
      userId: 'test-user-3',
      sellerId: new Types.ObjectId(sellerId),
      orderNumber: 'QC-TEST-PARTNER-3',
      fulfillmentStatus: 'HANDED_OVER',
      paymentStatus: 'PAID',
      amountPaise: 50000,
      itemTotalPaise: 50000,
      deliveryFeePaise: 0,
      handlingFeePaise: 0,
      partnerTipPaise: 0,
      couponDiscountPaise: 0,
      address: dummyAddress,
      partnerUid: 'partner-uid-3',
      partnerName: null,
      partnerPhone: null,
      items: [],
      createdAt: new Date(),
    },
  ];

  const inserted = await CustomerOrder.insertMany(mockOrders);
  const orderIds = inserted.map((o) => o._id);

  try {
    // Test Case 1: Order with full snapshot
    fetchCallCount = 0;
    const res1 = await (QcOrderService as any).listSellerOrders(sellerId, {
      fulfillmentStatus: 'HANDED_OVER',
    });
    const order1 = res1.items.find((i: any) => i.id === String(orderIds[0]));
    console.log('\nCase 1 (Full Snapshot):');
    console.log(`  partnerName: ${order1?.partnerName}`);
    console.log(`  partnerPhone: ${order1?.partnerPhone}`);
    console.log(`  partnerUid: partner-uid-1 -> was fetch called for uid 1?`);
    // Note: in the batch, orderIds[1] and orderIds[2] might trigger fetch, let's test isolated by querying getSellerOrder
    fetchCallCount = 0;
    const single1 = await (QcOrderService as any).getSellerOrder(sellerId, String(orderIds[0]));
    console.log(`  getSellerOrder fetchCallCount: ${fetchCallCount} (Expected: 0)`);
    const case1Pass = fetchCallCount === 0 && single1.order.partnerName === 'Snapshot Name 1';
    console.log(`  Case 1 Result: ${case1Pass ? 'PASSED' : 'FAILED'}`);

    // Test Case 2: Order with partial snapshot
    fetchCallCount = 0;
    const single2 = await (QcOrderService as any).getSellerOrder(sellerId, String(orderIds[1]));
    console.log('\nCase 2 (Partial Snapshot - missing phone):');
    console.log(`  getSellerOrder fetchCallCount: ${fetchCallCount} (Expected: 1)`);
    console.log(`  resolved partnerPhone: ${single2.order.partnerPhone}`);
    const case2Pass = fetchCallCount === 1 && single2.order.partnerPhone === '+919999999999';
    console.log(`  Case 2 Result: ${case2Pass ? 'PASSED' : 'FAILED'}`);

    // Test Case 3: Order with no snapshot
    fetchCallCount = 0;
    const single3 = await (QcOrderService as any).getSellerOrder(sellerId, String(orderIds[2]));
    console.log('\nCase 3 (No Snapshot):');
    console.log(`  getSellerOrder fetchCallCount: ${fetchCallCount} (Expected: 1)`);
    console.log(`  resolved partnerName: ${single3.order.partnerName}`);
    const case3Pass = fetchCallCount === 1 && single3.order.partnerName === 'Fetched Partner';
    console.log(`  Case 3 Result: ${case3Pass ? 'PASSED' : 'FAILED'}`);

    // Test Case 4: user-service unavailable -> graceful fallback
    const unavailOrder = await CustomerOrder.create({
      userId: 'test-user-4',
      sellerId: new Types.ObjectId(sellerId),
      orderNumber: 'QC-TEST-PARTNER-4',
      fulfillmentStatus: 'HANDED_OVER',
      paymentStatus: 'PAID',
      amountPaise: 50000,
      itemTotalPaise: 50000,
      deliveryFeePaise: 0,
      handlingFeePaise: 0,
      partnerTipPaise: 0,
      couponDiscountPaise: 0,
      address: dummyAddress,
      partnerUid: 'UNAVAILABLE_UID',
      partnerName: null,
      partnerPhone: null,
      items: [],
      createdAt: new Date(),
    });
    orderIds.push(unavailOrder._id);

    fetchCallCount = 0;
    console.log('\nCase 4 (user-service unavailable):');
    let single4: any = null;
    let errorThrown = false;
    try {
      single4 = await (QcOrderService as any).getSellerOrder(sellerId, String(unavailOrder._id));
    } catch (e) {
      errorThrown = true;
    }
    console.log(`  No exception thrown: ${!errorThrown}`);
    console.log(`  Fallback partnerName: ${single4?.order?.partnerName}`);
    const case4Pass = !errorThrown && single4 !== null;
    console.log(`  Case 4 Result: ${case4Pass ? 'PASSED' : 'FAILED'}`);

    const allPassed = case1Pass && case2Pass && case3Pass && case4Pass;
    console.log(`\nOverall Partner Bypass Verification: ${allPassed ? 'ALL 4 CASES PASSED' : 'FAILED'}`);
  } finally {
    // Restore original method and clean up
    (UserServiceClient as any).fetchPartnerProfile = originalFetchPartnerProfile;
    await CustomerOrder.deleteMany({ _id: { $in: orderIds } });
    console.log('Cleanup completed.');
  }

  await disconnectDatabase();
}

runPartnerBypassTests().catch(console.error);
