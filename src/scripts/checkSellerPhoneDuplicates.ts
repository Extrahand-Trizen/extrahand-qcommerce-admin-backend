/**
 * Pre-deploy safety check for the Seller identity fix.
 *   npx ts-node src/scripts/checkSellerPhoneDuplicates.ts
 *
 * Reports non-deleted Seller records that share a normalized (last-10) phone
 * number. The self-heal refuses to rebind an ambiguous phone, so duplicates are
 * safe at runtime — but you must resolve them before adding a UNIQUE index on
 * `Seller.mobileNumber`. This script never modifies data.
 *
 * Exit 0 = clean, exit 1 = duplicates found.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import Seller from '../models/Seller';
import { phoneLast10 } from '../utils/phone';

async function main() {
  await connectDatabase();
  const rows = await Seller.find({ status: { $ne: 'DELETED' } })
    .select('_id userId fullName mobileNumber status onboardingStatus createdAt')
    .lean();

  const byPhone = new Map<string, typeof rows>();
  const bad: string[] = [];
  for (const r of rows) {
    const key = phoneLast10(r.mobileNumber);
    if (!key) { bad.push(String(r._id)); continue; }
    byPhone.set(key, [...(byPhone.get(key) ?? []), r]);
  }

  const dupes = [...byPhone.entries()].filter(([, v]) => v.length > 1);

  console.log(`\n${rows.length} non-deleted sellers checked.\n`);

  if (bad.length) {
    console.log(`⚠️  ${bad.length} seller(s) with an unusable mobileNumber (< 10 digits): ${bad.join(', ')}\n`);
  }

  if (dupes.length === 0) {
    console.log('✅ No duplicate phone numbers. Safe to add a UNIQUE index on Seller.mobileNumber.');
    await disconnectDatabase();
    process.exit(bad.length ? 1 : 0);
  }

  console.log(`❌ ${dupes.length} phone number(s) shared by multiple sellers — resolve before a unique index:\n`);
  for (const [phone, sellers] of dupes) {
    console.log(`  ${phone}:`);
    for (const s of sellers) {
      console.log(`    ${s._id}  userId=${s.userId}  "${s.fullName}"  ${s.status}/${s.onboardingStatus}  created=${new Date(s.createdAt).toISOString()}`);
    }
  }
  console.log('\nDo NOT auto-merge. Decide per pair which seller is canonical.');
  await disconnectDatabase();
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
