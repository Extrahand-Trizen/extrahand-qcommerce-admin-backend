/**
 * Track B — confirm the Firebase service-account creds in .env are valid.
 * Does a dry-run FCM send (validated by Google, not delivered).
 *
 *   npx ts-node src/scripts/verifyFirebasePush.ts [optionalRealDeviceToken]
 */
import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env';

async function main() {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = env.FIREBASE_PRIVATE_KEY?.trim().replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in .env');
    process.exit(1);
  }
  console.log(`project: ${projectId}\nclient : ${clientEmail}`);

  const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  const fcm = getMessaging(app);

  const token = process.argv[2];
  try {
    if (token) {
      const id = await fcm.send({ token, data: { test: '1' } }, true); // dryRun
      console.log(`\n✓ creds OK, token OK — dry-run message id: ${id}`);
    } else {
      // No token: this still round-trips auth; it fails on the fake token, not the creds.
      await fcm.send({ token: 'fake-token-for-auth-check', data: { test: '1' } }, true).catch((e) => {
        const code = String(e?.errorInfo?.code || e?.code || '');
        const msg = String(e?.message || e);
        // Any token-related rejection means the service-account auth itself worked.
        if (/token|argument|not-found|not registered/i.test(code + ' ' + msg)) {
          console.log('\n✓ creds OK — service account authenticated (only the fake test token was rejected)');
        } else {
          throw e;
        }
      });
    }
  } catch (e) {
    console.error('\n✗ Firebase rejected the request:', (e as Error).message);
    process.exit(1);
  }
  process.exit(0);
}

main();
