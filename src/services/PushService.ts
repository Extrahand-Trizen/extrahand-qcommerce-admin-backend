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
  // A device token belongs to exactly ONE seller — whoever logged in last.
  // Detach it from any other seller first, otherwise a new-order alert for
  // seller A lands on a phone now signed in as seller B.
  await Seller.updateMany(
    { _id: { $ne: sellerId }, fcmTokens: t },
    { $pull: { fcmTokens: t } },
  );
  await Seller.updateOne({ _id: sellerId }, { $addToSet: { fcmTokens: t } });
}

export async function unregisterSellerToken(sellerId: string, token: string): Promise<void> {
  const t = String(token || '').trim();
  if (!t) return;
  await Seller.updateOne({ _id: sellerId }, { $pull: { fcmTokens: t } });
}

/** Loud new-order channel — must match incomingOrderAlert.ts CHANNEL_ID + res/raw/new_order_alert.wav. */
const NEW_ORDER_CHANNEL_ID = 'new-order-urgent-v3';
const NEW_ORDER_SOUND = 'new_order_alert';
/** Ordinary high-priority channel (stock-out etc.) — matches generalNotificationDisplay.ts. */
const GENERAL_CHANNEL_ID = 'general-v2';

/**
 * High-priority hybrid (`notification` + `data`) message.
 *
 * The `notification` block is what makes this reach the shopkeeper even when the
 * app is force-stopped by an aggressive OEM (Xiaomi/Realme/Oppo/Vivo): Android
 * itself draws the heads-up on the given channel — no app code has to run. `data`
 * is still carried so the app's foreground / background handlers can raise the
 * full-screen ringing alert when the process IS alive.
 *
 * `urgent: true` (default) uses the loud new-order channel + ringtone; pass
 * `urgent: false` for a normal high-priority alert (out-of-stock, etc.).
 */
export async function sendSellerOrderAlert(input: {
  sellerId: string;
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
  urgent?: boolean;
}): Promise<void> {
  const fcm = messaging();
  const tokens = (input.tokens || []).filter(Boolean);
  if (!fcm || tokens.length === 0) return;

  const { title, body } = input;
  const urgent = input.urgent !== false;
  const channelId = urgent ? NEW_ORDER_CHANNEL_ID : GENERAL_CHANNEL_ID;
  const collapseKey = input.data.orderId || input.data.eventKey || 'qc-alert';
  const collapseTag = `qc-${collapseKey}`;

  try {
    const res = await fcm.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: input.data,
      android: {
        priority: 'high',
        collapseKey: collapseTag,
        notification: {
          channelId,
          priority: 'max',
          visibility: 'public',
          tag: collapseTag,
          ...(urgent
            ? { sound: NEW_ORDER_SOUND, defaultSound: false }
            : { defaultSound: true }),
        },
      },
      apns: {
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert', 'apns-collapse-id': collapseTag },
        payload: {
          aps: {
            alert: { title, body },
            sound: 'default',
            'interruption-level': urgent ? 'time-sensitive' : 'active',
          },
        },
      },
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
