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
