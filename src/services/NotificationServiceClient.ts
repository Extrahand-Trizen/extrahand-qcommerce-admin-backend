import { env } from '../config/env';
import logger from '../config/logger';

/**
 * Thin client for the platform notification-service, for store deletion.
 *
 * `purgeSellerNotifications` asks the notification-service to hard-delete every
 * in-app notification tagged for the seller role for one user. It NEVER touches
 * FCM tokens (the device is shared with the person's other-role apps) and never
 * touches other roles' notification rows — the notification-service enforces
 * `data.recipientRole: 'seller'` server-side and rejects a bare userId.
 *
 * Best-effort: a notification-service outage must not block store deletion, but
 * the failure is logged loudly so it can be reconciled.
 */
export async function purgeSellerNotifications(userId: string): Promise<{ deletedCount: number } | null> {
  const baseUrl = env.NOTIFICATION_SERVICE_URL?.trim().replace(/\/$/, '');
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();

  if (!baseUrl || !serviceAuth) {
    logger.warn('purgeSellerNotifications skipped — NOTIFICATION_SERVICE_URL / SERVICE_AUTH_TOKEN not configured', { userId });
    return null;
  }
  if (!userId) return null;

  const url = `${baseUrl}/api/v1/notifications/in-app/purge`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'quick-commerce-service',
      },
      body: JSON.stringify({ userId, role: 'seller' }),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      logger.error('purgeSellerNotifications: notification-service returned non-2xx', {
        userId,
        status: res.status,
        body: text.slice(0, 300),
      });
      return null;
    }

    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
    const deletedCount = Number(parsed?.data?.deletedCount ?? 0);
    logger.info('purgeSellerNotifications: purged', { userId, deletedCount });
    return { deletedCount };
  } catch (err: any) {
    logger.error('purgeSellerNotifications failed (non-fatal)', { userId, error: err?.message });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Mirror a seller device's FCM token into the platform notification-service.
 *
 * The seller app registers its token with THIS backend (`POST /seller/push-token`,
 * which reliably works). The notification-service keeps its own separate token
 * store and every `sendPushNotification` (order completed / picked-up, shop
 * auto-pause, stock-out, …) looks tokens up there — so without this mirror those
 * pushes silently no-op ("No FCM tokens found for user …"). Best-effort:
 * `X-Service-Auth` + `X-User-Id` service-to-service, keyed by `Seller.userId`
 * (the same id those notifications are addressed to).
 */
export async function registerNotificationDeviceToken(
  userId: string,
  token: string,
  platform: 'ios' | 'android' | 'web' = 'android',
): Promise<boolean> {
  const baseUrl = env.NOTIFICATION_SERVICE_URL?.trim().replace(/\/$/, '');
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();
  const t = String(token || '').trim();
  if (!baseUrl || !serviceAuth || !userId || !t) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${baseUrl}/api/v1/notifications/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'quick-commerce-service',
        'X-User-Id': userId,
      },
      body: JSON.stringify({ token: t, platform }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn('registerNotificationDeviceToken: notification-service returned non-2xx', {
        userId,
        status: res.status,
      });
      return false;
    }
    return true;
  } catch (err: any) {
    logger.warn('registerNotificationDeviceToken failed (non-fatal)', { userId, error: err?.message });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Remove a mirrored token from the notification-service (seller signs out / token rotates). */
export async function unregisterNotificationDeviceToken(userId: string, token: string): Promise<void> {
  const baseUrl = env.NOTIFICATION_SERVICE_URL?.trim().replace(/\/$/, '');
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();
  const t = String(token || '').trim();
  if (!baseUrl || !serviceAuth || !userId || !t) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    await fetch(`${baseUrl}/api/v1/notifications/token`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'quick-commerce-service',
        'X-User-Id': userId,
      },
      body: JSON.stringify({ token: t }),
      signal: controller.signal,
    });
  } catch (err: any) {
    logger.warn('unregisterNotificationDeviceToken failed (non-fatal)', { userId, error: err?.message });
  } finally {
    clearTimeout(timeout);
  }
}
