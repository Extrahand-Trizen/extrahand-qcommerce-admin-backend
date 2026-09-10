import { env } from '../config/env';
import logger from '../config/logger';

/**
 * Thin client for the platform task-service.
 * Used to trigger auto-assign for Quick Commerce orders after payment.
 */

interface QcAutoAssignPayload {
  orderId: string;
  orderNumber: string;
  sellerId?: string;
  shopName?: string;
  shopCoordinates?: [number, number];
  shopAddress?: string;
}

interface QcAutoAssignResult {
  assigned: boolean;
  partner?: { uid: string; name: string; distKm?: number };
  reason?: string;
}

/**
 * Trigger auto-assign for a Quick Commerce order via the task-service.
 * Best-effort: task-service outage must not break payment flow.
 */
export async function triggerQcAutoAssign(payload: QcAutoAssignPayload): Promise<QcAutoAssignResult | null> {
  // Use MAIN_ADMIN_SERVICE_URL as the task-service base URL (both run on the same platform)
  const baseUrl = (env as any).MAIN_ADMIN_SERVICE_URL?.trim() || (env as any).TASK_SERVICE_URL?.trim();
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();

  if (!baseUrl || !serviceAuth) {
    logger.warn('triggerQcAutoAssign skipped — task-service URL / SERVICE_AUTH_TOKEN not configured', {
      orderId: payload.orderId,
    });
    return null;
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/qc/internal/auto-assign`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'qcommerce-admin',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('triggerQcAutoAssign: task-service returned non-2xx', {
        orderId: payload.orderId,
        status: res.status,
        body: text.slice(0, 500),
      });
      return null;
    }

    const json: any = await res.json().catch(() => null);
    return json?.data ?? json ?? null;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') {
      logger.warn('triggerQcAutoAssign: task-service timed out', { orderId: payload.orderId });
    } else {
      logger.warn('triggerQcAutoAssign: task-service call failed', {
        orderId: payload.orderId,
        error: err?.message,
      });
    }
    return null;
  }
}

export interface QcNotifyAvailablePayload {
  orderId: string;
  orderNumber: string;
  sellerId?: string;
  shopName?: string;
  shopCoordinates?: [number, number];
  shopAddress?: string;
  deliveryFee?: number;
}

export interface QcNotifyAvailableResult {
  success: boolean;
  notifiedCount: number;
  candidateUids: string[];
  reason?: string;
}

/**
 * Notify nearby partners (<= 3 km) via task-service that a new Quick Commerce order is available to apply.
 * Best-effort: task-service outage must not break payment confirmation.
 */
export async function notifyAvailableQcOrder(payload: QcNotifyAvailablePayload): Promise<QcNotifyAvailableResult | null> {
  const baseUrl = (env as any).MAIN_ADMIN_SERVICE_URL?.trim() || (env as any).TASK_SERVICE_URL?.trim();
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();

  if (!baseUrl || !serviceAuth) {
    logger.warn('notifyAvailableQcOrder skipped — task-service URL / SERVICE_AUTH_TOKEN not configured', {
      orderId: payload.orderId,
    });
    return null;
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/qc/internal/notify-available`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'qcommerce-admin',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('notifyAvailableQcOrder: task-service returned non-2xx', {
        orderId: payload.orderId,
        status: res.status,
        body: text.slice(0, 500),
      });
      return null;
    }

    const json: any = await res.json().catch(() => null);
    return json?.data ?? json ?? null;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') {
      logger.warn('notifyAvailableQcOrder: task-service timed out', { orderId: payload.orderId });
    } else {
      logger.warn('notifyAvailableQcOrder: task-service call failed', {
        orderId: payload.orderId,
        error: err?.message,
      });
    }
    return null;
  }
}

