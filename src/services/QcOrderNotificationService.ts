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

/**
 * Which app's in-app feed this notification belongs to. The notification-service
 * filters `GET /notifications/in-app?role=…` on `data.recipientRole`, so every
 * quick-commerce notification must declare it or it leaks into the wrong app.
 */
type QcRecipientRole = 'seller' | 'customer';

async function sendInAppNotification(payload: {
  userId: string;
  title: string;
  body: string;
  recipientRole: QcRecipientRole;
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
        category: 'system',
        data: { ...(payload.data || {}), recipientRole: payload.recipientRole },
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
  recipientRole: QcRecipientRole;
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
        category: 'system',
        title: payload.title,
        body: payload.body,
        ...(payload.priority ? { priority: payload.priority } : {}),
        data: {
          ...(payload.data || {}),
          eventKey: payload.eventKey,
          category: 'system',
          recipientRole: payload.recipientRole,
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
  refundIssued?: boolean;
}): Promise<void> {
  const customerUserId = String(input.customerUserId || '').trim();
  if (!customerUserId) return;

  const copy: Record<CustomerUpdateAction, { eventKey: string; title: string; body: string }> = {
    accept: {
      eventKey: 'QC_ORDER_ACCEPTED',
      title: 'Order packed',
      body: 'Order packed — searching for a delivery partner',
    },
    'start-preparing': {
      eventKey: 'QC_ORDER_PREPARING',
      title: 'Order being prepared',
      body: 'The shop has started preparing your order',
    },
    reject: {
      eventKey: 'QC_ORDER_REJECTED',
      title: 'Order could not be accepted',
      body: input.refundIssued
        ? 'Sorry — the shop could not accept your order. Your full refund has been initiated.'
        : 'The shop could not accept your order. Your refund needs attention; please contact support with the order number.',
    },
    'mark-ready': {
      eventKey: 'QC_ORDER_READY',
      title: 'Order packed',
      body: 'Order packed — searching for a delivery partner',
    },
    'mark-handed-over': {
      eventKey: 'QC_ORDER_HANDED_OVER',
      title: 'Order picked up',
      body: 'The delivery partner picked up your order and is on the way',
    },
    timeout: {
      eventKey: 'QC_ORDER_TIMED_OUT',
      title: 'Order not accepted in time',
      body: input.refundIssued
        ? "The shop didn't respond in time. Your order was cancelled and a full refund was initiated."
        : "The shop didn't respond in time. Your order was cancelled, but the refund needs attention; please contact support.",
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
    sendInAppNotification({ userId: customerUserId, title, body, recipientRole: 'customer', data }),
    sendPushNotification({ userId: customerUserId, title, body, eventKey, recipientRole: 'customer', data }),
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
    sendInAppNotification({ userId, title, body, recipientRole: 'seller', data }),
    sendPushNotification({ userId, title, body, eventKey: 'QC_SHOP_AUTO_PAUSED', recipientRole: 'seller', data, priority: 'high' }),
  ]);
}

/**
 * Tell the shopkeeper one or more products just went out of stock — either
 * because they hit 0 on an accepted order or because the seller edited the stock
 * to 0. Fired once, on the in-stock → out-of-stock transition only (the callers
 * guard that); customers can no longer order these until the seller restocks.
 *
 * Delivery mirrors the new-order alert: a server-side history record PLUS a
 * direct high-priority data push to the seller's device(s), so the alert
 * reaches the app in every state — foreground, background and fully closed —
 * without depending on the notification-service's own push path.
 */
export async function notifySellerOutOfStock(input: {
  sellerUserId: string;
  /** Seller doc _id — lets the push layer prune dead device tokens. */
  sellerId?: string;
  orderNumber?: string;
  products: Array<{ name: string; listingId?: string }>;
  /** The seller's device FCM tokens, for the direct out-of-stock alert. */
  fcmTokens?: string[];
}): Promise<void> {
  const userId = String(input.sellerUserId || '').trim();
  const products = (input.products || []).filter((p) => p?.name?.trim());
  if (!userId || products.length === 0) return;

  const names = products.map((p) => p.name.trim());
  const title = 'Product Out of Stock';
  const body =
    names.length === 1
      ? `"${names[0]}" is now out of stock. Update the stock to make it available again.`
      : `${names.length} products are now out of stock (${
          names.length <= 3
            ? names.join(', ')
            : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
        }). Update the stock to make them available again.`;
  const listingIds = products.map((p) => p.listingId).filter((id): id is string => !!id);
  const data: Record<string, unknown> = {
    eventKey: 'QC_STOCK_OUT',
    // title/body inline so the app can render the alert while running headless
    // (app killed) straight from the push data.
    title,
    body,
    productNames: names,
    ...(input.orderNumber ? { orderNumber: input.orderNumber } : {}),
    ...(listingIds.length ? { listingIds } : {}),
    // Single product → deep-link straight to its listing; many → the store list.
    ...(listingIds.length === 1 ? { listingId: listingIds[0] } : {}),
  };

  await Promise.all([
    // History record (server-side feed → Notifications tab). One per event.
    sendInAppNotification({ userId, title, body, recipientRole: 'seller', data }),
    // Direct high-priority data push to the seller's device(s) — same path the
    // new-order alert uses; works with the app backgrounded or fully closed.
    sendSellerOrderAlert({
      sellerId: String(input.sellerId || ''),
      tokens: input.fcmTokens ?? [],
      title,
      body,
      urgent: false, // stock-out is important but not the alarm-style new-order ring
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]),
      ),
    }),
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
    sendInAppNotification({ userId, title, body, recipientRole: 'seller', data }),
    sendPushNotification({ userId, title, body, eventKey: 'QC_SHOP_REOPENED', recipientRole: 'seller', data }),
  ]);
}

/** Order Pickup QR — a delivery partner scanned the QR and collected the order. */
export async function notifyPartnerPickedUpOrder(input: {
  sellerUserId: string;
  orderId: string;
  orderNumber: string;
  partnerName?: string;
}): Promise<void> {
  const userId = String(input.sellerUserId || '').trim();
  if (!userId) return;

  const who = String(input.partnerName || '').trim() || 'A delivery partner';
  const title = 'Order picked up';
  const body = `${who} picked up order #${input.orderNumber}.`;
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    eventKey: 'QC_ORDER_PICKED_UP',
    flowType: 'QUICK_COMMERCE',
  };

  await Promise.all([
    sendInAppNotification({ userId, title, body, recipientRole: 'seller', data }),
    sendPushNotification({ userId, title, body, eventKey: 'QC_ORDER_PICKED_UP', recipientRole: 'seller', data }),
  ]);
}

/** The delivery partner marked the order delivered (HANDED_OVER → COMPLETED). */
export async function notifySellerOrderCompleted(input: {
  sellerUserId: string;
  orderId: string;
  orderNumber: string;
  partnerName?: string;
}): Promise<void> {
  const userId = String(input.sellerUserId || '').trim();
  if (!userId) return;

  const who = String(input.partnerName || '').trim() || 'The delivery partner';
  const title = 'Order completed';
  const body = `${who} delivered order #${input.orderNumber}.`;
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    eventKey: 'QC_ORDER_COMPLETED',
    flowType: 'QUICK_COMMERCE',
  };

  await Promise.all([
    sendInAppNotification({ userId, title, body, recipientRole: 'seller', data }),
    sendPushNotification({ userId, title, body, eventKey: 'QC_ORDER_COMPLETED', recipientRole: 'seller', data }),
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
    sendInAppNotification({ userId, title, body, recipientRole: 'seller', data }),
    sendPushNotification({ userId, title, body, eventKey: 'QC_ORDER_AUTO_REJECTED', recipientRole: 'seller', data, priority: 'high' }),
  ]);
}

/**
 * Notify the seller when a customer cancels an active order (e.g. while
 * preparing or ready for pickup).
 */
export async function notifySellerOrderCancelled(input: {
  sellerUserId: string;
  orderNumber: string;
  orderId: string;
  reason?: string;
}): Promise<void> {
  const userId = String(input.sellerUserId || '').trim();
  if (!userId) return;

  const title = 'Order Cancelled';
  const reasonText = input.reason ? ` Reason: ${input.reason}` : '';
  const body = `Order #${input.orderNumber} was cancelled by the customer.${reasonText}`;
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    eventKey: 'QC_ORDER_CANCELLED',
    flowType: 'QUICK_COMMERCE',
    title,
    body,
  };

  await Promise.all([
    sendInAppNotification({ userId, title, body, recipientRole: 'seller', data }),
    sendPushNotification({ userId, title, body, eventKey: 'QC_ORDER_CANCELLED', recipientRole: 'seller', data, priority: 'high' }),
  ]);
}

/** Notify only the seller whose storefront received this order. */
export async function notifySellerNewOrder(input: NotifySellerNewOrderInput): Promise<void> {
  const sellerUserId = String(input.sellerUserId || '').trim();
  if (!sellerUserId) return;

  const title = 'New Order Received';
  const body = `You have received a new order. Order #${input.orderNumber} is waiting for your response.`;
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    sellerId: input.sellerId,
    amount: input.amountRupees,
    itemCount: input.itemCount,
    // title/body inline so the app can also raise a plain system-tray
    // notification headless (app killed), alongside the full-screen alert.
    title,
    body,
    // Track B — the app's incoming-order countdown reads this straight off the push.
    ...(input.acceptDeadline ? { acceptDeadline: input.acceptDeadline.toISOString() } : {}),
    eventKey: 'QC_ORDER_PLACED',
    flowType: 'QUICK_COMMERCE',
  };

  await Promise.all([
    // One history record for the Notifications tab.
    sendInAppNotification({ userId: sellerUserId, title, body, recipientRole: 'seller', data }),
    // Single high-priority data push to the seller's device(s). The app turns
    // this into BOTH the full-screen ringing alert AND a plain system-tray
    // notification that persists after the ring stops. The notification-service
    // push path is deliberately NOT used here — it would double the tray entry.
    sendSellerOrderAlert({
      sellerId: input.sellerId,
      tokens: input.fcmTokens ?? [],
      title,
      body,
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)]),
      ),
    }),
  ]);
}
