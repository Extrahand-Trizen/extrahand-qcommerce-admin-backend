/**
 * Read-only account audit across QC backend + user-service + notification-service.
 *   npx ts-node src/scripts/auditSellerAccount.ts 7893396338
 *
 * Never writes. Checks that Seller.userId, user-service Profile.uid, roles and
 * the seller<->profile link all agree, and reports FCM token coverage.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerStoreSettings from '../models/SellerStoreSettings';
import SellerListing from '../models/SellerListing';
import { env } from '../config/env';
import { phoneVariants, phoneLast10 } from '../utils/phone';

const USER_SVC = (env.USER_SERVICE_URL || '').replace(/\/$/, '').replace('localhost', '127.0.0.1');
const NOTIF_SVC = (process.env.NOTIFICATION_SERVICE_URL || '').replace(/\/$/, '').replace('localhost', '127.0.0.1');
const SVC_AUTH = env.SERVICE_AUTH_TOKEN || '';

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  try {
    const r = await fetch(url, { headers });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    return { status: 0, body: { error: (e as Error).message } };
  }
}

async function main() {
  const phone = process.argv[2];
  if (!phone) throw new Error('usage: auditSellerAccount.ts <phone>');
  await connectDatabase();

  const last10 = phoneLast10(phone);
  const rx = new RegExp(last10 + '$');
  const line = '─'.repeat(64);

  // ── QC: Seller ──────────────────────────────────────────────
  const sellers = await Seller.find({ mobileNumber: rx }).lean();
  console.log(`\n${line}\n QC BACKEND (cluster: ${env.MONGODB_URI?.split('@')[1]?.split('.')[0]})\n${line}`);
  console.log(`Seller rows for /${last10}$/ : ${sellers.length}${sellers.length > 1 ? '   ⚠️ DUPLICATE' : ''}`);
  let primary: (typeof sellers)[number] | undefined;
  for (const s of sellers) {
    const nonDeleted = s.status !== 'DELETED';
    if (nonDeleted && !primary) primary = s;
    console.log({
      _id: String(s._id),
      userId: s.userId,
      mobileNumber: s.mobileNumber,
      status: s.status,
      onboardingStatus: s.onboardingStatus,
      fullName: s.fullName,
      fcmTokens: (s.fcmTokens || []).length,
      createdAt: s.createdAt,
      lastLoginAt: (s as { lastLoginAt?: Date }).lastLoginAt,
    });
  }
  if (!primary) {
    console.log('\n❌ no non-deleted Seller for this phone — login WILL bounce to registration.');
    await disconnectDatabase();
    return;
  }

  const onb = await SellerOnboarding.findOne({ sellerId: primary._id }).lean();
  console.log('\nSellerOnboarding :', onb ? { status: onb.status } : 'NONE  ⚠️');
  const store = await SellerStoreSettings.findOne({ sellerId: primary._id }).lean();
  console.log('SellerStoreSettings :', store ? { _id: String(store._id), shopPaused: (store as { shopPaused?: boolean }).shopPaused } : 'NONE');
  const listings = await SellerListing.countDocuments({ sellerId: primary._id });
  console.log('SellerListing count :', listings);

  // ── user-service: Profile (internal endpoint) ───────────────
  console.log(`\n${line}\n USER-SERVICE  (${USER_SVC})\n${line}`);
  const prof = await getJson(`${USER_SVC}/api/v1/profiles/internal/${primary.userId}`, { 'X-Service-Auth': SVC_AUTH });
  console.log(`GET /profiles/internal/${primary.userId} -> ${prof.status}`);
  const p = (prof.body?.profile ?? prof.body?.data ?? prof.body ?? {}) as Record<string, unknown>;
  if (prof.status === 200) {
    console.log({
      uid: p.uid,
      phone: p.phone,
      roles: p.roles,
      isActive: p.isActive,
      sellerProfile: p.sellerProfile,
    });
  } else {
    console.log('  body:', JSON.stringify(prof.body).slice(0, 200));
    console.log('  ⚠️ no user-service profile for Seller.userId — phone self-heal cannot get a verified phone here');
  }

  // ── notification-service: token store ──────────────────────
  if (NOTIF_SVC) {
    console.log(`\n${line}\n NOTIFICATION-SERVICE  (${NOTIF_SVC})\n${line}`);
    const tk = await getJson(`${NOTIF_SVC}/api/v1/notifications/tokens/${primary.userId}`, {
      'X-Service-Auth': SVC_AUTH,
      'X-User-Id': primary.userId,
    });
    console.log(`GET /notifications/tokens/${primary.userId} -> ${tk.status}`);
    console.log('  body:', JSON.stringify(tk.body).slice(0, 300));
  }

  // ── verdict ────────────────────────────────────────────────
  console.log(`\n${line}\n VERDICT\n${line}`);
  const profUid = p.uid as string | undefined;
  const profRoles = (p.roles as string[] | undefined) || [];
  const linkedSellerId = (p.sellerProfile as { sellerId?: string } | undefined)?.sellerId;
  const checks: Array<[string, boolean, string]> = [
    ['exactly one non-deleted Seller', sellers.filter((s) => s.status !== 'DELETED').length === 1, `${sellers.filter((s) => s.status !== 'DELETED').length}`],
    ['Seller.status ACTIVE', primary.status === 'ACTIVE', primary.status],
    ['onboarding APPROVED', primary.onboardingStatus === 'APPROVED', primary.onboardingStatus],
    ['user-service profile found', prof.status === 200, `HTTP ${prof.status}`],
    ['Profile.uid === Seller.userId', !!profUid && profUid === primary.userId, `${profUid} vs ${primary.userId}`],
    ["Profile.roles includes 'seller'", profRoles.map(String).includes('seller'), JSON.stringify(profRoles)],
    ['Profile linked to this sellerId', linkedSellerId === String(primary._id), `${linkedSellerId} vs ${String(primary._id)}`],
  ];
  for (const [label, ok, detail] of checks) {
    console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : `   (${detail})`}`);
  }
  const allGood = checks.every(([, ok]) => ok);
  console.log(`\n${allGood ? '✅ ALL CONSISTENT — login resolves to this seller.' : '❌ mismatch above — see failed check.'}`);

  await disconnectDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
