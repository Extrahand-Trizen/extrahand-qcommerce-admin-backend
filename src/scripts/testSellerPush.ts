/**
 * Track B (Step 4) — send a fake QC_ORDER_PLACED data push to a shop's
 * registered devices, to test the app's background handler + full-screen alert
 * without placing a real order.
 *
 *   npx ts-node src/scripts/testSellerPush.ts <sellerId>
 *
 * Needs FIREBASE_SERVICE_ACCOUNT_PATH set and the app to have registered a token
 * (open the app, sign in — it POSTs /seller/push-token on launch).
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import { Types } from 'mongoose';
import { sendSellerOrderAlert } from '../services/PushService';
import { ACCEPT_WINDOW_SECONDS } from '../config/orderFulfillment';

async function main() {
  await connectDatabase();
  const arg = process.argv[2];
  if (!arg || !Types.ObjectId.isValid(arg)) {
    console.error('Usage: ts-node src/scripts/testSellerPush.ts <sellerId>');
    process.exit(1);
  }

  const seller = await Seller.findById(arg).select('fullName fcmTokens').lean();
  if (!seller) {
    console.error('No seller with that id.');
    process.exit(1);
  }
  console.log(`Seller: ${seller.fullName}  ·  ${seller.fcmTokens?.length ?? 0} device token(s)`);
  if (!seller.fcmTokens?.length) {
    console.error('No tokens registered — open the app + sign in first.');
    process.exit(1);
  }

  await sendSellerOrderAlert({
    sellerId: String(arg),
    tokens: seller.fcmTokens,
    data: {
      orderId: 'test-' + Date.now(),
      orderNumber: 'QC-PUSHTEST',
      sellerId: String(arg),
      amount: '199',
      itemCount: '2',
      acceptDeadline: new Date(Date.now() + ACCEPT_WINDOW_SECONDS * 1000).toISOString(),
      eventKey: 'QC_ORDER_PLACED',
      flowType: 'QUICK_COMMERCE',
    },
  });
  console.log('Sent. Check the device (lock it first to test the full-screen intent).');

  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
