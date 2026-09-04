/**
 * Product-offers migration — one-time, idempotent.
 *
 * 1. Drop the stale `sellerId_1_code_1` UNIQUE index on `promotions`. The model
 *    now makes it a PARTIAL unique index (only docs that actually have a `code`),
 *    because AUTOMATIC offers have no code and would otherwise all collide on
 *    `null`. Mongoose creates the new index but never drops the old one.
 * 2. Backfill `trigger: 'CODE'` and `appliesTo: 'ORDER'` on existing promotions
 *    so `?trigger=` / `appliesTo` filters behave (schema defaults only cover
 *    reads, not queries).
 *
 * Run:  npx ts-node src/scripts/migratePromotionsProductOffers.ts
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import Promotion from '../models/Promotion';

async function run(): Promise<void> {
  await connectDatabase();
  const coll = Promotion.collection;

  // 1. stale index ---------------------------------------------------------
  const indexes = await coll.indexes();
  const stale = indexes.find(
    (ix) => ix.name === 'sellerId_1_code_1' && !ix.partialFilterExpression,
  );
  if (stale) {
    await coll.dropIndex('sellerId_1_code_1');
    console.log('dropped stale index sellerId_1_code_1');
  } else {
    console.log('no stale sellerId_1_code_1 index — nothing to drop');
  }

  // 2. backfill -----------------------------------------------------------
  const trig = await Promotion.updateMany(
    { trigger: { $exists: false } },
    { $set: { trigger: 'CODE' } },
  );
  const scope = await Promotion.updateMany(
    { appliesTo: { $exists: false } },
    { $set: { appliesTo: 'ORDER', productMasterIds: [], productSnapshots: [] } },
  );
  console.log(`backfilled trigger on ${trig.modifiedCount}, appliesTo on ${scope.modifiedCount}`);

  // Recreate indexes from the current schema (adds the partial unique index).
  await Promotion.syncIndexes();
  console.log('synced Promotion indexes');

  await disconnectDatabase();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
