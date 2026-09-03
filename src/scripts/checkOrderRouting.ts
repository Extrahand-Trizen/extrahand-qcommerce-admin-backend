/**
 * Diagnose "the order went to the wrong store / the shopkeeper can't see it".
 *
 * An order is only visible to a shopkeeper when `CustomerOrder.sellerId` equals
 * that seller's `_id`. That value is chosen at checkout from `?sellerId` — and if
 * it's missing the backend silently falls back to a default seller
 * (env DEFAULT_STOREFRONT_SELLER_ID, else the seller with the most listings).
 *
 *   npx ts-node src/scripts/checkOrderRouting.ts [orderNumber]
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import { env } from '../config/env';

async function main() {
  await connectDatabase();

  const onlyOrder = process.argv[2];

  console.log('\n=== env ===');
  console.log('DEFAULT_STOREFRONT_SELLER_ID:', env.DEFAULT_STOREFRONT_SELLER_ID || '(not set)');

  const sellers = await Seller.find().select('_id userId status fullName').lean();
  const onboarding = await SellerOnboarding.find().select('sellerId shopName city').lean();
  const shopBySeller = new Map(onboarding.map((o) => [String(o.sellerId), o.shopName]));
  const sellerIds = new Set(sellers.map((s) => String(s._id)));

  console.log('\n=== sellers ===');
  for (const s of sellers) {
    console.log(
      `  ${String(s._id)}  status=${s.status}  user=${s.userId}  shop=${
        shopBySeller.get(String(s._id)) || s.fullName || '—'
      }`,
    );
  }

  const query = onlyOrder
    ? { orderNumber: onlyOrder }
    : { paymentStatus: 'PAID' as const };
  const orders = await CustomerOrder.find(query)
    .select('orderNumber sellerId shopName paymentStatus status fulfillmentStatus userId createdAt')
    .sort({ createdAt: -1 })
    .limit(onlyOrder ? 1 : 30)
    .lean();

  console.log(`\n=== ${onlyOrder ? 'order' : 'last 30 PAID orders'} ===`);
  for (const o of orders) {
    const sid = o.sellerId ? String(o.sellerId) : null;
    const flag = !sid
      ? '  ⚠️  NO sellerId — invisible to every shopkeeper'
      : !sellerIds.has(sid)
        ? '  ⚠️  sellerId is not an existing seller'
        : '';
    console.log(
      `  ${o.orderNumber}  seller=${sid ?? '(none)'}  shop="${o.shopName ?? ''}"  ` +
        `pay=${o.paymentStatus}  fulfil=${o.fulfillmentStatus ?? '(none)'}  ` +
        `customer=${o.userId}${flag}`,
    );
  }

  console.log('\nHow to read this:');
  console.log(
    '  - Give a shopkeeper their Seller _id from the list above; every order they ',
  );
  console.log('    should see must have that exact sellerId.');
  console.log(
    '  - Orders clustered on ONE sellerId regardless of which store the customer ',
  );
  console.log('    browsed = checkout is not receiving ?sellerId (falling back).');

  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
