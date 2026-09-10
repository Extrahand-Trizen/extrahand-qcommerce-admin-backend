/**
 * End-to-end test of attachSeller's UID-rotation self-heal over real HTTP.
 *
 *   npx ts-node src/scripts/testHealOverHttp.ts
 *
 * 1. dev-login 9999999999 via the gateway -> platform token (sub = local-test-...)
 * 2. flip that Seller.userId to a bogus value (simulates Firebase UID rotation)
 * 3. GET {PUBLIC_API_URL}/api/v1/sellers/onboarding/me with the token
 * 4. expect 200 + seller returned (healed by verified phone), userId rebound
 * 5. restore original userId no matter what
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';

const GATEWAY = (process.env.API_GATEWAY_URL?.trim() || 'http://127.0.0.1:5000').replace('localhost', '127.0.0.1');
const QC = (process.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:4010').replace('localhost', '127.0.0.1');
const PHONE = '+919999999999';

async function main() {
  await connectDatabase();

  // 1. login
  const loginRes = await fetch(`${GATEWAY}/api/v1/auth/otp/complete-dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, otp: '123456', mode: 'login', clientType: 'mobile', authChannel: 'seller_app' }),
  });
  const loginJson = (await loginRes.json()) as {
    tokens?: { accessToken?: string };
    profile?: { uid?: string };
  };
  const token: string | undefined = loginJson?.tokens?.accessToken;
  const tokenSub: string | undefined = loginJson?.profile?.uid;
  console.log('login:', loginRes.status, 'token sub =', tokenSub);
  if (!token) throw new Error('no token: ' + JSON.stringify(loginJson).slice(0, 300));

  // find the seller by phone (token sub may already differ after a prior heal)
  const seller = await Seller.findOne({ mobileNumber: /9999999999$/, status: { $ne: 'DELETED' } });
  if (!seller) throw new Error('no Seller for 9999999999 — cannot run test');
  const originalUserId = seller.userId;
  console.log('seller:', String(seller._id), 'userId:', originalUserId, 'phone:', seller.mobileNumber);

  const BOGUS = 'ROTATED_UID_TEST_' + Date.now();
  try {
    // 2. simulate rotation
    await Seller.updateOne({ _id: seller._id }, { $set: { userId: BOGUS } });
    console.log(`\n-> flipped Seller.userId to ${BOGUS} (token still carries ${tokenSub})`);

    // 3. call the protected endpoint
    const meRes = await fetch(`${QC}/api/v1/sellers/onboarding/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meJson: unknown = await meRes.json().catch(() => ({}));
    const j = meJson as { success?: boolean; data?: { seller?: { userId?: string; onboardingStatus?: string } }; error?: string };
    console.log('\nGET /sellers/onboarding/me ->', meRes.status);
    console.log('  success       :', j.success);
    console.log('  error         :', j.error);
    console.log('  seller.userId :', j.data?.seller?.userId);
    console.log('  onboarding    :', j.data?.seller?.onboardingStatus);

    const after = await Seller.findById(seller._id).select('userId').lean();
    console.log('  DB userId now :', after?.userId);

    const healed = meRes.status === 200 && j.success === true;
    const rebound = after?.userId === tokenSub;
    console.log(`\n${healed ? '✅' : '❌'} endpoint returned the seller after rotation`);
    console.log(`${rebound ? '✅' : '❌'} Seller.userId rebound to the token sub`);
    if (!healed) {
      console.log('\n>>> THIS is the "bounced to registration" bug: heal did not run / failed.');
    }
  } finally {
    await Seller.updateOne({ _id: seller._id }, { $set: { userId: originalUserId } });
    console.log('\nrestored Seller.userId ->', originalUserId);
  }

  await disconnectDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
