/**
 * Manually pause a shop (for testing the banner + countdown + auto-reopen).
 *   npx ts-node src/scripts/pauseShop.ts <sellerId> [minutes]     pause for N min (default 3)
 *   npx ts-node src/scripts/pauseShop.ts <sellerId> --clear       reopen now
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import SellerStoreSettings from '../models/SellerStoreSettings';

async function main() {
  await connectDatabase();
  const sellerId = process.argv[2];
  const arg = process.argv[3];
  if (!sellerId) { console.error('Usage: pauseShop.ts <sellerId> [minutes|--clear]'); process.exit(1); }

  if (arg === '--clear') {
    await SellerStoreSettings.updateOne(
      { sellerId },
      { $set: { storeStatus: 'OPEN', statusMode: 'MANUAL', rejectionCycleCount: 0 }, $unset: { autoPausedAt: 1, pauseUntil: 1, pauseReason: 1, rejectionCycleStartedAt: 1 } },
      { upsert: true },
    );
    console.log('Shop reopened.');
  } else {
    const minutes = Number(arg) || 3;
    const now = new Date();
    await SellerStoreSettings.updateOne(
      { sellerId },
      {
        $set: {
          storeStatus: 'CLOSED', statusMode: 'MANUAL',
          autoPausedAt: now,
          pauseUntil: new Date(now.getTime() + minutes * 60_000),
          pauseReason: 'Multiple orders were rejected or missed',
        },
      },
      { upsert: true },
    );
    console.log(`Shop paused for ${minutes} min (reopens ${new Date(now.getTime() + minutes * 60_000).toLocaleTimeString()}).`);
    console.log('Open the app Orders screen — the pause banner + countdown should show, then clear on its own.');
  }
  await disconnectDatabase();
}
main().catch((e) => { console.error(e); process.exit(1); });
