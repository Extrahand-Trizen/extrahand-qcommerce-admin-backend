/**
 * Fleet audit — every seller / store in the QC DB, cross-checked against
 * user-service. Read-only.
 *
 *   npx ts-node src/scripts/auditAllSellers.ts            # non-deleted only
 *   npx ts-node src/scripts/auditAllSellers.ts --all      # include DELETED
 *
 * "Healthy" = exactly one non-deleted Seller for the phone, a user-service
 * Profile whose uid === Seller.userId, roles includes 'seller', and
 * sellerProfile.sellerId points back to this Seller.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerStoreSettings from '../models/SellerStoreSettings';
import SellerListing from '../models/SellerListing';
import { env } from '../config/env';
import { phoneLast10 } from '../utils/phone';

const USER_SVC = (env.USER_SERVICE_URL || '').replace(/\/$/, '').replace('localhost', '127.0.0.1');
const SVC_AUTH = env.SERVICE_AUTH_TOKEN || '';

async function profileFor(uid: string): Promise<{ status: number; p: any }> {
  try {
    const r = await fetch(`${USER_SVC}/api/v1/profiles/internal/${encodeURIComponent(uid)}`, {
      headers: { 'X-Service-Auth': SVC_AUTH },
    });
    const body: any = await r.json().catch(() => null);
    return { status: r.status, p: body?.profile ?? body?.data ?? body ?? null };
  } catch (e) {
    return { status: 0, p: { error: (e as Error).message } };
  }
}

async function main() {
  const includeDeleted = process.argv.includes('--all');
  await connectDatabase();

  const sellers = await Seller.find(includeDeleted ? {} : { status: { $ne: 'DELETED' } })
    .sort({ createdAt: 1 })
    .lean();

  // phone-duplicate map (last-10)
  const byPhone = new Map<string, number>();
  for (const s of sellers) {
    if (s.status === 'DELETED') continue;
    const k = phoneLast10(s.mobileNumber);
    byPhone.set(k, (byPhone.get(k) ?? 0) + 1);
  }

  const rows: Array<Record<string, unknown>> = [];
  const tally = {
    total: sellers.length,
    healthy: 0,
    approved: 0,
    pendingOrDraft: 0,
    rejected: 0,
    noProfile: 0,
    uidMismatch: 0,
    noSellerRole: 0,
    notLinked: 0,
    noOnboarding: 0,
    duplicatePhone: 0,
    deleted: 0,
  };

  for (const s of sellers) {
    const sid = String(s._id);
    const onb = await SellerOnboarding.findOne({ sellerId: s._id }).select('status').lean();
    const store = await SellerStoreSettings.findOne({ sellerId: s._id }).select('_id').lean();
    const listings = await SellerListing.countDocuments({ sellerId: s._id });
    const { status: httpStatus, p } = await profileFor(s.userId);

    const dupCount = byPhone.get(phoneLast10(s.mobileNumber)) ?? 0;
    const profileFound = httpStatus === 200 && !!p?.uid;
    const uidOk = profileFound && p.uid === s.userId;
    const roleOk = profileFound && Array.isArray(p.roles) && p.roles.map(String).includes('seller');
    const linkOk = profileFound && p?.sellerProfile?.sellerId === sid;

    const issues: string[] = [];
    if (s.status === 'DELETED') { tally.deleted += 1; issues.push('DELETED'); }
    if (dupCount > 1 && s.status !== 'DELETED') { tally.duplicatePhone += 1; issues.push(`phone x${dupCount}`); }
    if (!onb) { tally.noOnboarding += 1; issues.push('no onboarding'); }
    if (!profileFound) { tally.noProfile += 1; issues.push(`no user-svc profile (HTTP ${httpStatus})`); }
    else {
      if (!uidOk) { tally.uidMismatch += 1; issues.push(`uid≠ (profile ${p.uid})`); }
      if (!roleOk) { tally.noSellerRole += 1; issues.push(`roles ${JSON.stringify(p.roles)}`); }
      if (!linkOk) { tally.notLinked += 1; issues.push(`link ${p?.sellerProfile?.sellerId ?? 'none'}`); }
    }

    const healthy =
      s.status !== 'DELETED' && dupCount === 1 && profileFound && uidOk && roleOk && linkOk;
    if (healthy) tally.healthy += 1;

    switch (s.onboardingStatus) {
      case 'APPROVED': tally.approved += 1; break;
      case 'REJECTED': tally.rejected += 1; break;
      default: tally.pendingOrDraft += 1;
    }

    rows.push({
      phone: s.mobileNumber,
      name: s.fullName,
      sellerId: sid,
      userId: s.userId,
      status: s.status,
      onboarding: s.onboardingStatus,
      store: store ? 'yes' : 'NO',
      listings,
      health: healthy ? 'OK' : issues.join(' | ') || '—',
    });
  }

  console.log(`\n================ ${rows.length} SELLER(S) ================\n`);
  for (const r of rows) {
    console.log(
      `${r.health === 'OK' ? '✅' : '⚠️ '} ${String(r.phone).padEnd(13)} ${String(r.name).slice(0, 18).padEnd(19)} ` +
      `${r.onboarding}`.padEnd(18) +
      `store:${r.store} listings:${r.listings}`,
    );
    console.log(`     sellerId ${r.sellerId}  userId ${r.userId}`);
    if (r.health !== 'OK') console.log(`     ⚠️  ${r.health}`);
  }

  console.log(`\n================ SUMMARY ================`);
  console.log(`  Total sellers/stores          : ${tally.total}`);
  console.log(`  ✅ Fully healthy               : ${tally.healthy}`);
  console.log(`  ── onboarding APPROVED         : ${tally.approved}`);
  console.log(`  ── onboarding pending/draft    : ${tally.pendingOrDraft}`);
  console.log(`  ── onboarding rejected         : ${tally.rejected}`);
  console.log(`  ⚠️  no user-service profile     : ${tally.noProfile}`);
  console.log(`  ⚠️  uid mismatch               : ${tally.uidMismatch}`);
  console.log(`  ⚠️  missing 'seller' role      : ${tally.noSellerRole}`);
  console.log(`  ⚠️  profile not linked to shop : ${tally.notLinked}`);
  console.log(`  ⚠️  no onboarding record       : ${tally.noOnboarding}`);
  console.log(`  ⚠️  phone shared by >1 seller  : ${tally.duplicatePhone}`);
  if (includeDeleted) console.log(`  🗑  deleted                    : ${tally.deleted}`);

  await disconnectDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
