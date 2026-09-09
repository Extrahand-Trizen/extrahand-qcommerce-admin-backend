/**
 * One-time backfill: for every Seller, ensure the user-service Profile has the
 * `seller` role (merged, never replacing other roles) and
 * `sellerProfile.sellerId` set. Also rebinds `Seller.userId` when the profile's
 * current Firebase UID has drifted.
 *
 *   npx ts-node src/scripts/backfillSellerRoleAndLink.ts          # dry run (reports only)
 *   npx ts-node src/scripts/backfillSellerRoleAndLink.ts --apply  # actually write
 *
 * Needs USER_SERVICE_URL + SERVICE_AUTH_TOKEN. Never creates a Profile, never
 * deletes or merges sellers. Exits 1 if any orphan / conflict needs a human.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import { linkSellerToUser } from '../services/UserServiceClient';
import { env } from '../config/env';

async function main() {
  if (!env.USER_SERVICE_URL || !env.SERVICE_AUTH_TOKEN) {
    console.error('USER_SERVICE_URL / SERVICE_AUTH_TOKEN not set — cannot reach user-service.');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  await connectDatabase();

  const sellers = await Seller.find({ status: { $ne: 'DELETED' } })
    .select('_id userId mobileNumber fullName status')
    .sort({ createdAt: 1 })
    .lean();

  console.log(`\n${sellers.length} non-deleted seller(s). Mode: ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  const tally = {
    ok: 0, roleAdded: 0, uidRebound: 0,
    orphan: [] as string[], conflict: [] as string[], error: [] as string[], transport: 0,
  };

  for (const s of sellers) {
    const id = String(s._id);
    try {
      const r = await linkSellerToUser({
        sellerId: id,
        userId: s.userId,
        phone: s.mobileNumber,
        preview: !apply,
      });
      if (r.conflict) {
        tally.conflict.push(`${id} (${s.mobileNumber}) → profile ${r.profileUid}`);
        console.log(`  ⚠ CONFLICT  ${id}  ${s.mobileNumber}  — profile linked to a different seller`);
        continue;
      }
      if (r.transportError) {
        tally.transport += 1;
        console.log(`  ✗ USER-SERVICE UNREACHABLE  ${id}  ${s.mobileNumber}  (route missing / non-2xx — is user-service redeployed?)`);
        continue;
      }
      if (!r.found) {
        tally.orphan.push(`${id} (${s.mobileNumber}, uid=${s.userId})`);
        console.log(`  ✗ NO PROFILE  ${id}  ${s.mobileNumber}  uid=${s.userId}`);
        continue;
      }
      tally.ok += 1;
      if (r.sellerRoleAdded) tally.roleAdded += 1;
      if (r.reboundSellerUserId) tally.uidRebound += 1;
      const notes = [
        r.matchedBy === 'phone' ? 'matched-by-phone' : '',
        r.sellerRoleAdded ? 'role+seller' : '',
        r.reboundSellerUserId ? `userId→${r.reboundSellerUserId}` : '',
      ].filter(Boolean).join(' ');
      console.log(`  ✓ ${id}  ${s.mobileNumber}  ${notes || 'already linked'}`);
    } catch (e) {
      tally.error.push(`${id}: ${(e as Error).message}`);
      console.log(`  ✗ ERROR  ${id}  ${(e as Error).message}`);
    }
  }

  console.log('\n── summary ──');
  console.log(`  linked ok        : ${tally.ok}`);
  console.log(`  seller role added: ${tally.roleAdded}`);
  console.log(`  Seller.userId rebound: ${tally.uidRebound}`);
  if (tally.transport) console.log(`  ⚠ user-service unreachable for: ${tally.transport}  — redeploy user-service, then re-run`);
  console.log(`  orphan (no profile): ${tally.orphan.length}`);
  tally.orphan.forEach((o) => console.log(`     - ${o}`));
  console.log(`  conflict (different seller): ${tally.conflict.length}`);
  tally.conflict.forEach((c) => console.log(`     - ${c}`));
  console.log(`  errors: ${tally.error.length}`);
  tally.error.forEach((e) => console.log(`     - ${e}`));

  if (!apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to link.');
  }

  await disconnectDatabase();
  process.exit(tally.orphan.length || tally.conflict.length || tally.error.length || tally.transport ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
