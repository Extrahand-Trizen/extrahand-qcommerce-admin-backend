import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import { Types } from 'mongoose';

async function main() {
  await connectDatabase();

  const isClearOnly = process.argv.includes('--clear');

  // Locate seller by phone number 7981580955
  const seller = await Seller.findOne({ mobileNumber: '7981580955' }).select('_id userId fullName mobileNumber').lean();
  if (!seller) {
    console.error('❌ Seller with phone 7981580955 not found!');
    process.exit(1);
  }

  const sellerId = seller._id;
  const onboarding = await SellerOnboarding.findOne({ sellerId }).select('shopName city').lean();
  const shopName = onboarding?.shopName || seller.fullName || 'Venkatesh Test Shop';

  // Define IST Sunday Oct 4, 2026 time boundary (2026-10-03T18:30:00.000Z to 2026-10-04T18:29:59.999Z)
  const oct4Start = new Date('2026-10-03T18:30:00.000Z');
  const oct4End = new Date('2026-10-04T18:29:59.999Z');

  // 1. CLEAR ALL existing orders for this seller on Sunday, Oct 4, 2026
  const deleted = await CustomerOrder.deleteMany({
    sellerId,
    createdAt: { $gte: oct4Start, $lte: oct4End },
  });
  console.log(`\n🧹 Cleared ${deleted.deletedCount} existing order(s) for Sunday, October 4, 2026.`);

  if (isClearOnly) {
    await disconnectDatabase();
    return;
  }

  // 2. Define 13 orders that sum up to EXACTLY ₹2,000 item total
  // 150 + 120 + 180 + 100 + 160 + 220 + 110 + 175 + 135 + 240 + 120 + 150 + 140 = ₹2,000
  const oct4OrdersData = [
    { num: '01', istTime: '2026-10-04T08:30:00+05:30', itemTotalRupees: 150, customer: 'Ramesh K' },
    { num: '02', istTime: '2026-10-04T09:15:00+05:30', itemTotalRupees: 120, customer: 'Sita M' },
    { num: '03', istTime: '2026-10-04T10:00:00+05:30', itemTotalRupees: 180, customer: 'Praveen R' },
    { num: '04', istTime: '2026-10-04T11:30:00+05:30', itemTotalRupees: 100, customer: 'Anitha B' },
    { num: '05', istTime: '2026-10-04T12:45:00+05:30', itemTotalRupees: 160, customer: 'Vijay P' },
    { num: '06', istTime: '2026-10-04T14:15:00+05:30', itemTotalRupees: 220, customer: 'Sunil G' },
    { num: '07', istTime: '2026-10-04T15:30:00+05:30', itemTotalRupees: 110, customer: 'Kavitha N' },
    { num: '08', istTime: '2026-10-04T16:45:00+05:30', itemTotalRupees: 175, customer: 'Mahesh C' },
    { num: '09', istTime: '2026-10-04T17:50:00+05:30', itemTotalRupees: 135, customer: 'Divya S' },
    { num: '10', istTime: '2026-10-04T19:00:00+05:30', itemTotalRupees: 240, customer: 'Srikanth K' },
    { num: '11', istTime: '2026-10-04T19:45:00+05:30', itemTotalRupees: 120, customer: 'Preeti V' },
    { num: '12', istTime: '2026-10-04T20:30:00+05:30', itemTotalRupees: 150, customer: 'Rajesh T' },
    { num: '13', istTime: '2026-10-04T21:20:00+05:30', itemTotalRupees: 140, customer: 'Harish L' },
  ];

  let grandTotalRupees = 0;

  for (const data of oct4OrdersData) {
    const itemTotalPaise = data.itemTotalRupees * 100;
    const deliveryFeePaise = 2900; // ₹29
    const amountPaise = itemTotalPaise + deliveryFeePaise;
    const orderDate = new Date(data.istTime);

    grandTotalRupees += data.itemTotalRupees;

    await CustomerOrder.create({
      userId: `oct4-customer-${data.num}`,
      sellerId,
      shopName,
      shopCity: onboarding?.city || 'Hyderabad',
      orderNumber: `QC-OCT4-100${data.num}`,
      status: 'completed',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'COMPLETED',
      handoverCode: `40${data.num}`,
      items: [
        {
          productSlug: 'grocery-sample-item',
          masterProductId: new Types.ObjectId(),
          name: `Daily Essentials #${data.num}`,
          unit: '1 pack',
          quantity: 1,
          unitPricePaise: itemTotalPaise,
          lineTotalPaise: itemTotalPaise,
        },
      ],
      address: {
        label: 'Home',
        line1: 'Flat 101, Test Residency',
        city: onboarding?.city || 'Hyderabad',
        pinCode: '500081',
        name: data.customer,
        phone: '9848012345',
      },
      itemTotalPaise,
      deliveryFeePaise,
      handlingFeePaise: 0,
      couponDiscountPaise: 0,
      amountPaise,
      createdAt: orderDate,
      updatedAt: orderDate,
      completedAt: orderDate,
      fulfillmentEvents: [
        { action: 'PLACED', by: 'system', at: orderDate },
        { action: 'COMPLETED', by: 'system', at: orderDate },
      ],
    });
  }

  console.log(`\n✅ Successfully generated 13 test orders (EXACTLY ₹2,000 total) for Sunday, October 4, 2026!`);
  console.log(`  Shop Owner  : ${seller.fullName} (${shopName})`);
  console.log(`  Phone Number: ${seller.mobileNumber}`);
  console.log(`  Seller ID   : ${sellerId.toString()}`);
  console.log(`  Total Orders: ${oct4OrdersData.length}`);
  console.log(`  Total Sales : ₹${grandTotalRupees.toLocaleString('en-IN')}`);
  console.log(`  Target Date : Sunday, October 4, 2026`);
  console.log(`\nOpen the Seller App and check the Dashboard / Sales Trend section! 🚀\n`);

  await disconnectDatabase();
}

main().catch((err) => {
  console.error('Execution error:', err);
  process.exit(1);
});
