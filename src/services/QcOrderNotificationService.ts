import { env } from '../config/env';
import logger from '../config/logger';
import { sendSellerOrderAlert } from './PushService';

type NotifySellerNewOrderInput = {
  sellerUserId: string;
  sellerId: string;
  orderId: string;
  orderNumber: string;
  amountRupees: number;
  itemCount: number;
  /** Track B — when the shopkeeper's accept window runs out. */
  acceptDeadline?: Date;
  /** Track B — the seller's device FCM tokens, for the direct new-order alert. */
  fcmTokens?: string[];
};

function notificationServiceBaseUrl(): string | null {
  const baseUrl = env.NOTIFICATION_SERVICE_URL?.trim();
  return baseUrl ? baseUrl.replace(/\/$/, '') : null;
}

function serviceAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Service-Auth': env.SERVICE_AUTH_TOKEN || '',
    'X-Service-Name': 'quick-commerce-service',
  };
}

async function sendInAppNotification(payload: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const baseUrl = notificationServiceBaseUrl();
  if (!baseUrl || !env.SERVICE_AUTH_TOKEN) {
    logger.warn('notify: in-app skipped (NOTIFICATION_SERVICE_URL / SERVICE_AUTH_TOKEN unset)', {
      to: payload.userId,
      title: payload.title,
    });
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/notifications/in-app/send`, {
      method: 'POST',
      headers: serviceAuthHeaders(),
      body: JSON.stringify({
        userId: payload.userId,
        title: payload.title,
        body: payload.body,
        type: 'success',
        category: 'orders',
        data: payload.data,
      }),
    });
    if (!res.ok) {
      logger.warn('notify: in-app rejected', { status: res.status, to: payload.userId, title: payload.title });
    } else {
      logger.info('notify: in-app sent', { to: payload.userId, title: payload.title });
    }
  } catch (err) {
    logger.warn('notify: in-app request failed', { err, to: payload.userId });
  }
}

async function sendPushNotification(payload: {
  userId: string;
  title: string;
  body: string;
  eventKey: string;
  data?: Record<string, unknown>;
  /** Track B — 'high' asks the notification-service to send a high-priority
   *  data message that wakes the device (new-order alert). Honoured only if the
   *  notification-service supports it; harmless otherwise. */
  priority?: 'normal' | 'high';
}): Promise<void> {
  const baseUrl = notificationServiceBaseUrl();
  if (!baseUrl || !env.SERVICE_AUTH_TOKEN) {
    logger.warn('notify: push skipped (NOTIFICATION_SERVICE_URL / SERVICE_AUTH_TOKEN unset)', {
      to: payload.userId,
      eventKey: payload.eventKey,
    });
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/notifications/send`, {
      method: 'POST',
      headers: serviceAuthHeaders(),
      body: JSON.stringify({
        recipients: [payload.userId],
        eventKey: payload.eventKey,
        category: 'orders',
        title: payload.title,
        body: payload.body,
        ...(payload.priority ? { priority: payload.priority } : {}),
        data: {
          ...(payload.data || {}),
          eventKey: payload.eventKey,
          category: 'orders',
        },
        entity: {
          type: 'qc_order',
          id: String(payload.data?.orderId || payload.eventKey),
        },
      }),
    });
    if (!res.ok) {
      logger.warn('notify: push rejected', { status: res.status, to: payload.userId, eventKey: payload.eventKey });
    } else {
      logger.info('notify: push sent', { to: payload.userId, eventKey: payload.eventKey });
    }
  } catch (err) {
    logger.warn('notify: push request failed', { err, to: payload.userId, eventKey: payload.eventKey });
  }
}

type CustomerUpdateAction =
  | 'accept'
  | 'start-preparing'
  | 'reject'
  | 'mark-ready'
  | 'mark-handed-over'
  /** Track B — the shop didn't accept before `acceptDeadline`. */
  | 'timeout'
  /** Track E — the shop bumped the prep estimate. */
  | 'extend-prep';

/**
 * Notify the customer that the shopkeeper moved their order forward. Exactly one
 * message per transition — no per-item / per-product commentary.
 */
export async function notifyCustomerOrderUpdate(input: {
  customerUserId: string;
  orderId: string;
  orderNumber: string;
  action: CustomerUpdateAction;
  prepMinutes?: number;
  addMinutes?: number;
}): Promise<void> {
  const customerUserId = String(input.customerUserId || '').trim();
  if (!customerUserId) return;

  const copy: Record<CustomerUpdateAction, { eventKey: string; title: string; body: string }> = {
    accept: {
      eventKey: 'QC_ORDER_ACCEPTED',
      title: 'Order accepted',
      body: input.prepMinutes
        ? `The shop is on it — ready in about ${input.prepMinutes} min`
        : 'The shop has accepted your order',
    },
    'start-preparing': {
      eventKey: 'QC_ORDER_PREPARING',
      title: 'Order being prepared',
      body: 'The shop has started preparing your order',
    },
    reject: {
      eventKey: 'QC_ORDER_REJECTED',
      title: 'Order could not be accepted',
      body: 'Sorry — the shop could not accept your order. You have been refunded in full.',
    },
    'mark-ready': {
      eventKey: 'QC_ORDER_READY',
      title: 'Order packed',
      body: 'Your order is packed and waiting for a delivery partner',
    },
    'mark-handed-over': {
      eventKey: 'QC_ORDER_HANDED_OVER',
      title: 'Order picked up',
      body: 'Your order is on its way',
    },
    timeout: {
      eventKey: 'QC_ORDER_TIMED_OUT',
      title: 'Order not accepted in time',
      body: "The shop didn't respond in time, so your order was cancelled and fully refunded.",
    },
    'extend-prep': {
      eventKey: 'QC_ORDER_PREP_EXTENDED',
      title: 'Order running a little late',
      body: input.addMinutes
        ? `The shop needs about ${input.addMinutes} more min to get your order ready`
        : 'The shop needs a little more time to get your order ready',
    },
  };

  const { eventKey, title, body } = copy[input.action];
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    eventKey,
    flowType: 'QUICK_COMMERCE',
  };

  await Promise.all([
    sendInAppNotification({ userId: customerUserId, title, body, data }),
    sendPushNotification({ userId: customerUserId, title, body, eventKey, data }),
  ]);
}

/**
 * Track B — tell the shopkeeper their shop was auto-paused after too many
 * rejected/missed orders. It reopens itself when the pause expires.
 */
export async function notifySellerShopAutoPaused(input: {
  sellerUserId: string;
  rejections: number;
  pauseUntil?: Date;
}): Promise<void> {
  const userId = String(input.sellerUserId || '').trim();
  if (!userId) return;

  const until = input.pauseUntil
    ? new Date(input.pauseUntil).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : null;
  const title = 'Orders paused';
  const body = `${input.rejections} orders were rejected or missed. Your shop is paused${until ? ` and will reopen around ${until}` : ''}. You don't need to do anything.`;
  const data = {
    eventKey: 'QC_SHOP_AUTO_PAUSED',
    rejections: input.rejections,
    ...(input.pauseUntil ? { pauseUntil: new Date(input.pauseUntil).toISOString() } : {}),
  };

  await Promise.all([
    sendInAppNotification({ userId, title, body, data }),
    sendPushNotification({ userId, title, body, eventKey: 'QC_SHOP_AUTO_PAUSED', data, priority: 'high' }),
  ]);
}

/** Track B — the auto-pause expired; the shop is open again. */
export async function notifySellerShopReopened(input: { sellerUserId: string }): Promise<void> {
  const userId = String(input.sellerUserId || '').trim();
  if (!userId) return;
  const title = 'Orders open again';
  const body = 'Your pause is over — customers can order from your shop again.';
  const data = { eventKey: 'QC_SHOP_REOPENED' };
  await Promise.all([
    sendInAppNotification({ userId, title, body, data }),
    sendPushNotification({ userId, title, body, eventKey: 'QC_SHOP_REOPENED', data }),
  ]);
}

/**
 * Track B — tell the shopkeeper an order auto-rejected because they didn't accept
 * it within the window. Shows up in the app's Rejected tab.
 */
export async function notifySellerOrderAutoRejected(input: {
  sellerUserId: string;
  orderNumber: string;
  orderId: string;
}): Promise<void> {
  const userId = String(input.sellerUserId || '').trim();
  if (!userId) return;

  const title = 'Order missed — auto-rejected';
  const body = `Order ${input.orderNumber} wasn't accepted in time. It was cancelled and the customer refunded.`;
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    eventKey: 'QC_ORDER_AUTO_REJECTED',
    flowType: 'QUICK_COMMERCE',
  };

  await Promise.all([
    sendInAppNotification({ userId, title, body, data }),
    sendPushNotification({ userId, title, body, eventKey: 'QC_ORDER_AUTO_REJECTED', data, priority: 'high' }),
  ]);
}

/** Notify only the seller whose storefront received this order. */
export async function notifySellerNewOrder(input: NotifySellerNewOrderInput): Promise<void> {
  const sellerUserId = String(input.sellerUserId || '').trim();
  if (!sellerUserId) return;

  const title = 'New grocery order';
  const body = `Order ${input.orderNumber} — ${input.itemCount} item${
    input.itemCount === 1 ? '' : 's'
  } · ₹${input.amountRupees}`;
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    sellerId: input.sellerId,
    amount: input.amountRupees,
    itemCount: input.itemCount,
    // Track B — the app's incoming-order countdown reads this straight off the push.
    ...(input.acceptDeadline ? { acceptDeadline: input.acceptDeadline.toISOString() } : {}),
    eventKey: 'QC_ORDER_PLACED',
    flowType: 'QUICK_COMMERCE',
  };

  await Promise.all([
    sendInAppNotification({ userId: sellerUserId, title, body, data }),
    sendPushNotification({
      userId: sellerUserId,
      title,
      body,
      eventKey: 'QC_ORDER_PLACED',
      data,
      // New orders must punch through Doze / a locked screen.
      priority: 'high',
    }),
    // Track B — direct FCM data message to the shopkeeper's device(s), which the
    // app turns into the full-screen ringing alert.
    sendSellerOrderAlert({
      sellerId: input.sellerId,
      tokens: input.fcmTokens ?? [],
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)]),
      ),
    }),
  ]);
}
