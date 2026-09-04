/**
 * Drop one ready-to-work test order into a shop's queue so you can walk the
 * seller app UI (New → Accept → Preparing → Ready → Handover) without the
 * customer side being wired yet.
 *
 *   npx ts-node src/scripts/seedSellerTestOrder.ts <sellerId>
 *
 * Get <sellerId> from:  npx ts-node src/scripts/checkOrderRouting.ts
 * Test orders are numbered QC-TEST-… — delete them with:
 *   npx ts-node src/scripts/seedSellerTestOrder.ts --clear
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import { Types } from 'mongoose';
import { generateHandoverCode } from '../services/QcOrderService';
import { ACCEPT_WINDOW_SECONDS } from '../config/orderFulfillment';

async function main() {
  await connectDatabase();
  const arg = process.argv[2];

  if (arg === '--clear') {
    const res = await CustomerOrder.deleteMany({ orderNumber: /^QC-TEST-/ });
    console.log(`Deleted ${res.deletedCount} test order(s).`);
    await disconnectDatabase();
    return;
  }

  if (!arg || !Types.ObjectId.isValid(arg)) {
    console.error('Usage: ts-node src/scripts/seedSellerTestOrder.ts <sellerId>');
    console.error('Run checkOrderRouting.ts to list seller ids.');
    process.exit(1);
  }

  const sellerId = new Types.ObjectId(arg);
  const seller = await Seller.findById(sellerId).select('_id userId fullName').lean();
  if (!seller) {
    console.error('No seller with that id.');
    process.exit(1);
  }
  const onboarding = await SellerOnboarding.findOne({ sellerId }).select('shopName city').lean();

  const items = [
    { productSlug: 'test-amul-taaza-1l', masterProductId: new Types.ObjectId(), name: 'Amul Taaza Milk', unit: '1 L', quantity: 2, unitPricePaise: 6800, lineTotalPaise: 13600 },
    { productSlug: 'test-tata-salt-1kg', masterProductId: new Types.ObjectId(), name: 'Tata Salt', unit: '1 kg', quantity: 1, unitPricePaise: 2800, lineTotalPaise: 2800 },
  ];
  const itemTotalPaise = items.reduce((s, i) => s + i.lineTotalPaise, 0);
  const deliveryFeePaise = 2900;

  const order = await CustomerOrder.create({
    userId: 'test-customer',
    sellerId,
    shopName: onboarding?.shopName || seller.fullName || 'Test shop',
    shopCity: onboarding?.city,
    orderNumber: `QC-TEST-${Date.now().toString(36).toUpperCase()}`,
    status: 'PAID',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'PENDING_ACCEPT',
    acceptDeadline: new Date(Date.now() + ACCEPT_WINDOW_SECONDS * 1000),
    handoverCode: generateHandoverCode(),
    fulfillmentEvents: [{ action: 'PLACED', by: 'system', at: new Date(), meta: { test: true } }],
    items,
    address: {
      label: 'Home',
      line1: 'Flat 402, Sai Residency',
      line2: 'Madhapur',
      city: onboarding?.city || 'Hyderabad',
      pinCode: '500081',
      name: 'Test Customer',
      phone: '9848012345',
    },
    deliveryInstructions: ['Ring the bell twice'],
    partnerTipPaise: 0,
    itemTotalPaise,
    deliveryFeePaise,
    handlingFeePaise: 0,
    couponDiscountPaise: 0,
    amountPaise: itemTotalPaise + deliveryFeePaise,
  });

  console.log(`\n✓ Test order ${order.orderNumber} created for ${order.shopName}`);
  console.log(`  fulfillmentStatus: PENDING_ACCEPT  ·  handoverCode: ${order.handoverCode}`);
  console.log(`  acceptDeadline: ${order.acceptDeadline?.toISOString()} (${ACCEPT_WINDOW_SECONDS}s)`);
  console.log('  → open the seller app, it should show under "New" with a countdown.');
  console.log('  (use the handoverCode above at the "Hand to delivery partner" step)\n');

  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
