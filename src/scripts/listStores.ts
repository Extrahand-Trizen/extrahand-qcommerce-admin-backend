/**
 * Quick DB overview — every seller/store and its key data.
 *   npx ts-node src/scripts/listStores.ts
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerStoreSettings from '../models/SellerStoreSettings';
import SellerListing from '../models/SellerListing';
import CustomerOrder from '../models/CustomerOrder';

async function main() {
  await connectDatabase();

  const sellers = await Seller.find().sort({ createdAt: 1 }).lean();
  console.log(`\n=== ${sellers.length} seller(s)/store(s) ===\n`);

  for (const s of sellers) {
    const id = String(s._id);
    const [onb, settings, listings, orders, paidOrders] = await Promise.all([
      SellerOnboarding.findOne({ sellerId: s._id }).select('shopName city state pincode address shopType businessType status').lean(),
      SellerStoreSettings.findOne({ sellerId: s._id }).select('storeStatus statusMode openTime closeTime autoPausedAt pauseUntil rejectionDay dailyRejectedCount rejectionCycleCount bankAccount').lean(),
      SellerListing.countDocuments({ sellerId: s._id }),
      CustomerOrder.countDocuments({ sellerId: s._id }),
      CustomerOrder.countDocuments({ sellerId: s._id, paymentStatus: 'PAID' }),
    ]);

    console.log(`● ${onb?.shopName || s.fullName || '(no shop name)'}`);
    console.log(`  sellerId       : ${id}`);
    console.log(`  userId         : ${s.userId}`);
    console.log(`  owner          : ${s.fullName}  ·  ${s.mobileNumber}${s.email ? '  ·  ' + s.email : ''}`);
    console.log(`  seller status  : ${s.status}   onboarding: ${s.onboardingStatus}`);
    console.log(`  shop           : ${onb?.shopType || '—'}  ·  ${onb?.city || '—'}${onb?.state ? ', ' + onb.state : ''}${onb?.pincode ? ' ' + onb.pincode : ''}${onb?.address ? '  ·  ' + onb.address : ''}`);
    console.log(`  store status   : ${settings?.storeStatus || '(no settings)'} / ${settings?.statusMode || '-'}  hours ${settings?.openTime || '?'}-${settings?.closeTime || '?'}${settings?.autoPausedAt ? '  ⚠ AUTO-PAUSED until ' + (settings.pauseUntil?.toISOString() ?? '?') : ''}`);
    console.log(`  rejections     : cycle ${settings?.rejectionCycleCount ?? 0}  ·  today ${settings?.dailyRejectedCount ?? 0}${settings?.rejectionDay ? ' (' + settings.rejectionDay + ')' : ''}`);
    console.log(`  bank account   : ${settings?.bankAccount ? settings.bankAccount.accountHolderName + ' / ' + settings.bankAccount.ifscCode + ' (' + settings.bankAccount.verificationStatus + ')' : 'not set'}`);
    console.log(`  fcm tokens     : ${s.fcmTokens?.length ?? 0}`);
    console.log(`  listings       : ${listings}`);
    console.log(`  orders         : ${orders} total  ·  ${paidOrders} paid`);
    console.log('');
  }

  // Order fulfilment snapshot across all stores
  const byFulfil = await CustomerOrder.aggregate([
    { $match: { paymentStatus: 'PAID' } },
    { $group: { _id: '$fulfillmentStatus', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  console.log('=== PAID orders by fulfilmentStatus (all stores) ===');
  for (const row of byFulfil) console.log(`  ${row._id || '(none)'} : ${row.n}`);

  await disconnectDatabase();
}

main().catch((e) => { console.error(e); process.exit(1); });
