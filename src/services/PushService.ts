import { readFileSync } from 'fs';
import { initializeApp, cert, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging, type SendResponse } from 'firebase-admin/messaging';
import { env } from '../config/env';
import logger from '../config/logger';
import Seller from '../models/Seller';

/**
 * Track B (Step 4) — the qc-backend sends the new-order alert straight to FCM,
 * so it reaches the shopkeeper's phone even when the app is backgrounded /
 * killed / the screen is locked. (The customer-facing messages still go through
 * the notification-service.)
 *
 * No-ops with a logged warning when FIREBASE_SERVICE_ACCOUNT_PATH is unset —
 * same pattern as the notification + payment services.
 */

let app: App | null = null;
let initTried = false;

function loadServiceAccount(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawKey = env.FIREBASE_PRIVATE_KEY?.trim();
  if (projectId && clientEmail && rawKey) {
    // `.env` keeps the PEM on one line with literal \n — turn them back into newlines.
    return { projectId, clientEmail, privateKey: rawKey.replace(/\\n/g, '\n') };
  }

  const path = env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (path) {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key };
  }
  return null;
}

function messaging(): Messaging | null {
  if (initTried) return app ? getMessaging(app) : null;
  initTried = true;

  let serviceAccount: ReturnType<typeof loadServiceAccount>;
  try {
    serviceAccount = loadServiceAccount();
  } catch (err) {
    logger.error('PushService: failed to read Firebase service-account creds', { err });
    return null;
  }
  if (!serviceAccount) {
    logger.warn('PushService: Firebase creds unset (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY) — seller push disabled');
    return null;
  }

  try {
    app = initializeApp({ credential: cert(serviceAccount) });
    logger.info('PushService: firebase-admin initialised', { projectId: serviceAccount.projectId });
    return getMessaging(app);
  } catch (err) {
    logger.error('PushService: failed to init firebase-admin', { err });
    return null;
  }
}

export async function registerSellerToken(sellerId: string, token: string): Promise<void> {
  const t = String(token || '').trim();
  if (!t) return;
  await Seller.updateOne({ _id: sellerId }, { $addToSet: { fcmTokens: t } });
}

export async function unregisterSellerToken(sellerId: string, token: string): Promise<void> {
  const t = String(token || '').trim();
  if (!t) return;
  await Seller.updateOne({ _id: sellerId }, { $pull: { fcmTokens: t } });
}

/**
 * High-priority, data-only message. Data-only (no `notification` block) so the
 * app's background handler always runs and builds the full-screen Notifee alert
 * itself.
 */
export async function sendSellerOrderAlert(input: {
  sellerId: string;
  tokens: string[];
  data: Record<string, string>;
}): Promise<void> {
  const fcm = messaging();
  const tokens = (input.tokens || []).filter(Boolean);
  if (!fcm || tokens.length === 0) return;

  try {
    const res = await fcm.sendEachForMulticast({
      tokens,
      data: input.data,
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { contentAvailable: true } } },
    });

    // Prune tokens FCM rejected as permanently invalid.
    const dead: string[] = [];
    res.responses.forEach((r: SendResponse, i: number) => {
      const code = r.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        dead.push(tokens[i]);
      }
    });
    if (dead.length) {
      await Seller.updateOne({ _id: input.sellerId }, { $pull: { fcmTokens: { $in: dead } } });
      logger.info('PushService: pruned dead FCM tokens', { sellerId: input.sellerId, count: dead.length });
    }
  } catch (err) {
    logger.error('PushService: sendSellerOrderAlert failed', { err });
  }
}
