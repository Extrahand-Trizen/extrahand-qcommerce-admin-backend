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
        role: payload.recipientRole,
        recipientRole: payload.recipientRole,
        data: { ...(payload.data || {}), recipientRole: payload.recipientRole, role: payload.recipientRole },
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
        role: payload.recipientRole,
        recipientRole: payload.recipientRole,
        targetApp: payload.recipientRole === 'seller' ? 'com.extrahand.seller' : 'com.extrahand',
        ...(payload.priority ? { priority: payload.priority } : {}),
        data: {
          ...(payload.data || {}),
          eventKey: payload.eventKey,
          category: 'system',
          role: payload.recipientRole,
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

function buildQcLiveStatusMeta(
  action: CustomerUpdateAction | 'delivered' | 'cancelled',
  input: { prepMinutes?: number; addMinutes?: number },
): {
  liveStatusTitle: string;
  liveStatusLine: string;
  liveProgressCurrent: number;
  liveProgressMax: number;
  liveIsTerminal: '0' | '1';
  liveEtaMins?: string;
} {
  switch (action) {
    case 'accept':
      return {
        liveStatusTitle: 'Your order is getting packed',
        liveStatusLine: 'Store accepted your order',
        liveProgressCurrent: 2,
        liveProgressMax: 4,
        liveIsTerminal: '0',
        ...(input.prepMinutes ? { liveEtaMins: String(Math.max(1, Math.round(input.prepMinutes))) } : {}),
      };
    case 'start-preparing':
      return {
        liveStatusTitle: 'Your order is getting packed',
        liveStatusLine: 'Store is preparing your order',
        liveProgressCurrent: 2,
        liveProgressMax: 4,
        liveIsTerminal: '0',
        ...(input.prepMinutes ? { liveEtaMins: String(Math.max(1, Math.round(input.prepMinutes))) } : {}),
      };
    case 'mark-ready':
      return {
        liveStatusTitle: 'Order packed',
        liveStatusLine: 'Searching for a delivery partner',
        liveProgressCurrent: 3,
        liveProgressMax: 4,
        liveIsTerminal: '0',
      };
    case 'mark-handed-over':
      return {
        liveStatusTitle: 'Order picked up',
        liveStatusLine: 'Delivery partner is on the way',
        liveProgressCurrent: 3,
        liveProgressMax: 4,
        liveIsTerminal: '0',
      };
    case 'extend-prep':
      return {
        liveStatusTitle: 'Order running a little late',
        liveStatusLine: input.addMinutes
          ? `Store added ${Math.round(input.addMinutes)} min`
          : 'Store needs a little more time',
        liveProgressCurrent: 2,
        liveProgressMax: 4,
        liveIsTerminal: '0',
      };
    case 'reject':
    case 'timeout':
      return {
        liveStatusTitle: 'Unable to deliver this order',
        liveStatusLine: 'Order closed',
        liveProgressCurrent: 4,
        liveProgressMax: 4,
        liveIsTerminal: '1',
      };
    case 'delivered':
      return {
        liveStatusTitle: 'Order delivered',
        liveStatusLine: 'Delivered successfully',
        liveProgressCurrent: 4,
        liveProgressMax: 4,
        liveIsTerminal: '1',
      };
    case 'cancelled':
      return {
        liveStatusTitle: 'Order cancelled',
        liveStatusLine: 'Order closed',
        liveProgressCurrent: 4,
        liveProgressMax: 4,
        liveIsTerminal: '1',
      };
  }
}

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
      title: 'Order accepted',
      body: 'The shop accepted your order and started preparing it',
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
  const liveMeta = buildQcLiveStatusMeta(input.action, {
    prepMinutes: input.prepMinutes,
    addMinutes: input.addMinutes,
  });
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    eventKey,
    flowType: 'QUICK_COMMERCE',
    ...liveMeta,
  };

  await Promise.all([
    sendInAppNotification({ userId: customerUserId, title, body, recipientRole: 'customer', data }),
    sendPushNotification({ userId: customerUserId, title, body, eventKey, recipientRole: 'customer', data }),
  ]);
}

/** Terminal update — customer order delivered. */
export async function notifyCustomerOrderDelivered(input: {
  customerUserId: string;
  orderId: string;
  orderNumber: string;
}): Promise<void> {
  const customerUserId = String(input.customerUserId || '').trim();
  if (!customerUserId) return;

  const eventKey = 'QC_ORDER_DELIVERED';
  const title = 'Order delivered';
  const body = 'Your order has been delivered. Thank you for choosing ExtraHand.';
  const liveMeta = buildQcLiveStatusMeta('delivered', {});
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    eventKey,
    flowType: 'QUICK_COMMERCE',
    ...liveMeta,
  };

  await Promise.all([
    sendInAppNotification({ userId: customerUserId, title, body, recipientRole: 'customer', data }),
    sendPushNotification({ userId: customerUserId, title, body, eventKey, recipientRole: 'customer', data }),
  ]);
}

/** Terminal update — order cancelled by customer. */
export async function notifyCustomerOrderCancelled(input: {
  customerUserId: string;
  orderId: string;
  orderNumber: string;
}): Promise<void> {
  const customerUserId = String(input.customerUserId || '').trim();
  if (!customerUserId) return;

  const eventKey = 'QC_ORDER_CANCELLED';
  const title = 'Order cancelled';
  const body = 'Your order has been cancelled.';
  const liveMeta = buildQcLiveStatusMeta('cancelled', {});
  const data = {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    eventKey,
    flowType: 'QUICK_COMMERCE',
    ...liveMeta,
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
  const title = 'Orders Temporarily Paused';
  const body = until
    ? `Your shop has been temporarily paused because ${input.rejections} orders were missed or not accepted. New orders will resume around ${until}.`
    : 'Your shop has been temporarily paused. Please check your store status for more information.';
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
      ? `${names[0]} is out of stock. Update its availability to start selling again.`
      : `${names.length} products are out of stock. Update their stock availability to continue selling.`;
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

/** Tell seller their shop is open again (auto-pause expired or manually toggled). */
export async function notifySellerShopReopened(input: {
  sellerUserId: string;
  sellerId?: string;
  fcmTokens?: string[];
}): Promise<void> {
  const userId = String(input.sellerUserId || '').trim();
  if (!userId) return;
  const title = 'Your Shop Is Back Online';
  const body = 'Your shop is active again. You can now receive new orders.';
  const data = { eventKey: 'QC_SHOP_REOPENED', title, body };

  let directDelivered = false;
  if (input.fcmTokens && input.fcmTokens.length > 0) {
    const alertResult = await sendSellerOrderAlert({
      sellerId: String(input.sellerId || ''),
      tokens: input.fcmTokens,
      title,
      body,
      urgent: false,
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)]),
      ),
    });
    directDelivered = (alertResult?.successCount ?? 0) > 0;
  }

  const tasks: Promise<void>[] = [
    sendInAppNotification({ userId, title, body, recipientRole: 'seller', data }),
  ];

  if (!directDelivered) {
    tasks.push(
      sendPushNotification({ userId, title, body, eventKey: 'QC_SHOP_REOPENED', recipientRole: 'seller', data }),
    );
  }

  await Promise.all(tasks);
}

/** Shared dispatcher for seller in-app + push + direct FCM alerts. */
async function dispatchSellerAlert(input: {
  sellerId?: string;
  sellerUserId?: string;
  fcmTokens?: string[];
  eventKey: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  urgent?: boolean;
  skipPush?: boolean;
}): Promise<void> {
  let userId = String(input.sellerUserId || '').trim();
  let fcmTokens = input.fcmTokens;

  if ((!userId || !fcmTokens) && input.sellerId) {
    try {
      const { default: Seller } = await import('../models/Seller');
      const seller = await Seller.findById(input.sellerId).select('userId fcmTokens').lean();
      if (!userId && seller?.userId) userId = String(seller.userId).trim();
      if (!fcmTokens && seller?.fcmTokens) fcmTokens = seller.fcmTokens;
    } catch {
      // ignore lookup failure
    }
  }

  if (!userId) return;

  const payload = { ...input.data, eventKey: input.eventKey, title: input.title, body: input.body };

  let directDelivered = false;
  if (!input.skipPush && fcmTokens && fcmTokens.length > 0) {
    const alertResult = await sendSellerOrderAlert({
      sellerId: String(input.sellerId || ''),
      tokens: fcmTokens,
      title: input.title,
      body: input.body,
      urgent: Boolean(input.urgent),
      data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)])),
    });
    directDelivered = (alertResult?.successCount ?? 0) > 0;
  }

  const tasks: Promise<void>[] = [
    sendInAppNotification({ userId, title: input.title, body: input.body, recipientRole: 'seller', data: payload }),
  ];

  // Only fall back to notification-service push if direct FCM delivery was not performed and push is not suppressed
  if (!input.skipPush && !directDelivered) {
    tasks.push(
      sendPushNotification({
        userId,
        title: input.title,
        body: input.body,
        eventKey: input.eventKey,
        recipientRole: 'seller',
        data: payload,
      }),
    );
  }

  await Promise.all(tasks);
}

/** Bank payout notification — tell seller money was transferred to their bank account. */
export async function notifySellerPayoutTransferred(input: {
  sellerUserId: string;
  sellerId?: string;
  amountRupees: number;
  payoutId?: string;
  fcmTokens?: string[];
}): Promise<void> {
  const formattedAmount = input.amountRupees.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });
  await dispatchSellerAlert({
    sellerUserId: input.sellerUserId,
    sellerId: input.sellerId,
    fcmTokens: input.fcmTokens,
    eventKey: 'QC_PAYOUT_TRANSFERRED',
    title: 'Payout Successful',
    body: `Your payout of ₹${formattedAmount} has been successfully transferred to your registered bank account.`,
    data: {
      amount: input.amountRupees,
      ...(input.payoutId ? { payoutId: input.payoutId } : {}),
    },
  });
}

/** Payout status change alert — processing, failed, or completed. */
export async function notifySellerPayoutStatus(input: {
  sellerId: string;
  payoutId: string;
  amountRupees: number;
  status: 'PROCESSING' | 'FAILED' | 'COMPLETED';
  failureReason?: string;
}): Promise<void> {
  const formattedAmount = input.amountRupees.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });

  if (input.status === 'COMPLETED') {
    await dispatchSellerAlert({
      sellerId: input.sellerId,
      eventKey: 'QC_PAYOUT_TRANSFERRED',
      title: 'Payout Successful',
      body: `Your payout of ₹${formattedAmount} has been successfully transferred to your registered bank account.`,
      data: { payoutId: input.payoutId, amount: input.amountRupees, status: input.status },
    });
    return;
  }

  const isFailed = input.status === 'FAILED';
  await dispatchSellerAlert({
    sellerId: input.sellerId,
    eventKey: isFailed ? 'QC_PAYOUT_FAILED' : 'QC_PAYOUT_PROCESSING',
    title: isFailed ? 'Payout Unsuccessful' : 'Payout in Progress',
    body: isFailed
      ? `We couldn't complete your payout of ₹${formattedAmount}. The amount will remain in your available balance. Please check your payout details or contact support if you need assistance.`
      : `Your payout of ₹${formattedAmount} is being processed. We'll notify you once the transfer is completed.`,
    urgent: isFailed,
    data: {
      payoutId: input.payoutId,
      amount: input.amountRupees,
      status: input.status,
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    },
  });
}

/** Bank account update & verification status alert — verified, pending, or rejected. */
export async function notifySellerBankAccountAlert(input: {
  sellerId: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  accountNumberMasked?: string;
  bankName?: string;
  reason?: string;
  isUpdate?: boolean;
  skipPush?: boolean;
}): Promise<void> {
  const digitsMatch = input.accountNumberMasked?.match(/\d{4}$/);
  const lastFourDigits = digitsMatch ? digitsMatch[0] : (input.accountNumberMasked || 'your account');

  const config =
    input.status === 'VERIFIED'
      ? {
          eventKey: 'QC_BANK_ACCOUNT_VERIFIED',
          title: 'Bank Account Verified',
          body: `Your bank account ending in ${lastFourDigits} has been successfully verified and is ready to receive payouts.`,
          urgent: false,
        }
      : input.status === 'REJECTED'
        ? {
            eventKey: 'QC_BANK_ACCOUNT_REJECTED',
            title: 'Bank Verification Unsuccessful',
            body: 'We couldn\'t verify your bank account. Please check your account details and try again.',
            urgent: true,
          }
        : {
            eventKey: 'QC_BANK_ACCOUNT_UPDATED',
            title: 'Bank Details Submitted',
            body: 'Your updated bank details have been submitted successfully and are awaiting verification.',
            urgent: false,
          };

  await dispatchSellerAlert({
    sellerId: input.sellerId,
    eventKey: config.eventKey,
    title: config.title,
    body: config.body,
    urgent: config.urgent,
    skipPush: input.skipPush,
    data: {
      verificationStatus: input.status,
      ...(input.accountNumberMasked ? { accountNumberMasked: input.accountNumberMasked } : {}),
      ...(input.bankName ? { bankName: input.bankName } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
}

/** Order Pickup QR — a delivery partner scanned the QR and collected the order. */
export async function notifyPartnerPickedUpOrder(input: {
  sellerUserId: string;
  sellerId?: string;
  orderId: string;
  orderNumber: string;
  partnerName?: string;
  fcmTokens?: string[];
}): Promise<void> {
  const who = String(input.partnerName || '').trim() || 'A delivery partner';
  const title = 'Order picked up';
  const body = `${who} picked up order #${input.orderNumber}.`;

  await dispatchSellerAlert({
    sellerUserId: input.sellerUserId,
    sellerId: input.sellerId,
    fcmTokens: input.fcmTokens,
    eventKey: 'QC_ORDER_PICKED_UP',
    title,
    body,
    data: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      flowType: 'QUICK_COMMERCE',
    },
  });
}

/** The delivery partner marked the order delivered (HANDED_OVER → COMPLETED). */
export async function notifySellerOrderCompleted(input: {
  sellerUserId: string;
  sellerId?: string;
  orderId: string;
  orderNumber: string;
  partnerName?: string;
  fcmTokens?: string[];
}): Promise<void> {
  const title = 'Order Completed';
  const body = `Order #${input.orderNumber} has been successfully delivered to the customer.`;

  await dispatchSellerAlert({
    sellerUserId: input.sellerUserId,
    sellerId: input.sellerId,
    fcmTokens: input.fcmTokens,
    eventKey: 'QC_ORDER_COMPLETED',
    title,
    body,
    data: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      flowType: 'QUICK_COMMERCE',
    },
  });
}

/**
 * Track B — tell the shopkeeper an order auto-rejected because they didn't accept
 * it within the window. Shows up in the app's Rejected tab.
 */
export async function notifySellerOrderAutoRejected(input: {
  sellerUserId: string;
  sellerId?: string;
  orderNumber: string;
  orderId: string;
  fcmTokens?: string[];
}): Promise<void> {
  const title = 'Order Missed';
  const body = `You didn't respond to order #${input.orderNumber} in time. The order has been automatically cancelled.`;

  await dispatchSellerAlert({
    sellerUserId: input.sellerUserId,
    sellerId: input.sellerId,
    fcmTokens: input.fcmTokens,
    eventKey: 'QC_ORDER_AUTO_REJECTED',
    title,
    body,
    urgent: false,
    data: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      flowType: 'QUICK_COMMERCE',
    },
  });
}

/**
 * Notify the seller when a customer cancels an active order (e.g. while
 * preparing or ready for pickup).
 */
export async function notifySellerOrderCancelled(input: {
  sellerUserId: string;
  sellerId?: string;
  orderNumber: string;
  orderId: string;
  reason?: string;
  fcmTokens?: string[];
}): Promise<void> {
  const title = 'Order Cancelled';
  const body = `Order #${input.orderNumber} has been cancelled by the customer.`;

  await dispatchSellerAlert({
    sellerUserId: input.sellerUserId,
    sellerId: input.sellerId,
    fcmTokens: input.fcmTokens,
    eventKey: 'QC_ORDER_CANCELLED',
    title,
    body,
    urgent: false,
    data: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      flowType: 'QUICK_COMMERCE',
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
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

  const stringifiedData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)]),
  );

  let directAlertDelivered = false;
  if (input.fcmTokens && input.fcmTokens.length > 0) {
    const alertResult = await sendSellerOrderAlert({
      sellerId: input.sellerId,
      tokens: input.fcmTokens,
      title,
      body,
      data: stringifiedData,
    });
    directAlertDelivered = (alertResult?.successCount ?? 0) > 0;
  }

  const tasks: Promise<void>[] = [
    // One history record for the Notifications tab.
    sendInAppNotification({ userId: sellerUserId, title, body, recipientRole: 'seller', data }),
  ];

  // Fallback: If direct seller FCM alert had no tokens or failed, route push through the platform
  // notification service which resolves active user tokens by userId from the database.
  if (!directAlertDelivered) {
    logger.info('notifySellerNewOrder: direct FCM alert not delivered; dispatching via notification-service push fallback', {
      sellerUserId,
      sellerId: input.sellerId,
      orderId: input.orderId,
    });
    tasks.push(
      sendPushNotification({
        userId: sellerUserId,
        title,
        body,
        eventKey: 'QC_ORDER_PLACED',
        recipientRole: 'seller',
        priority: 'high',
        data,
      }),
    );
  }

  await Promise.all(tasks);
}

/**
 * Atomic helper to send the new-order alert push notification to the seller.
 * Uses `sellerNotifiedAt` to ensure FCM push is sent EXACTLY ONCE per order,
 * regardless of which service created or updated the order in MongoDB.
 */
export async function triggerSellerNewOrderAlertIfNeeded(
  orderId: string | unknown,
): Promise<boolean> {
  const { default: CustomerOrder } = await import('../models/CustomerOrder');
  const { default: Seller } = await import('../models/Seller');

  const now = new Date();
  const order = await CustomerOrder.findOneAndUpdate(
    {
      _id: orderId as never,
      sellerNotifiedAt: { $exists: false },
      fulfillmentStatus: 'PENDING_ACCEPT',
    },
    { $set: { sellerNotifiedAt: now } },
    { new: true },
  ).lean();

  if (!order || !order.sellerId) return false;

  const seller = await Seller.findById(order.sellerId).select('userId fcmTokens').lean();
  if (!seller?.userId) return false;

  const itemCount = (order.items || []).reduce((sum, item) => sum + item.quantity, 0);
  await notifySellerNewOrder({
    sellerUserId: seller.userId,
    sellerId: order.sellerId.toString(),
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    amountRupees: ((order.itemTotalPaise ?? order.amountPaise) || 0) / 100,
    itemCount,
    acceptDeadline: order.acceptDeadline,
    fcmTokens: seller.fcmTokens ?? [],
  });

  return true;
}

const ONBOARDING_NOTIFICATION_COPY: Record<
  'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED',
  { eventKey: string; legacyType: string; title: string; defaultBody: string }
> = {
  APPROVED: {
    eventKey: 'QC_ONBOARDING_APPROVED',
    legacyType: 'ONBOARDING_APPROVED',
    title: 'Application Approved!',
    defaultBody: 'Congratulations! Your seller account has been approved. Welcome to ExtraHand!',
  },
  CHANGES_REQUIRED: {
    eventKey: 'QC_ONBOARDING_CHANGES_REQUIRED',
    legacyType: 'ONBOARDING_CORRECTION_REQUIRED',
    title: 'Action Required: Update Your Application',
    defaultBody: 'Some information in your seller application needs to be updated. Please review the requested changes and resubmit your application.',
  },
  REJECTED: {
    eventKey: 'QC_ONBOARDING_REJECTED',
    legacyType: 'ONBOARDING_REJECTED',
    title: 'Application Update',
    defaultBody: 'Unfortunately, your seller application could not be approved. Please check your application status or contact support for assistance.',
  },
};

async function deliverSellerStatusNotification(input: {
  sellerUserId: string;
  sellerId: string;
  title: string;
  body: string;
  eventKey: string;
  fcmTokens?: string[];
  data: Record<string, string>;
}): Promise<void> {
  const userId = String(input.sellerUserId || '').trim();
  let directDelivered = false;
  if (input.fcmTokens && input.fcmTokens.length > 0) {
    const alertResult = await sendSellerOrderAlert({
      sellerId: String(input.sellerId),
      tokens: input.fcmTokens,
      title: input.title,
      body: input.body,
      data: input.data,
      urgent: false,
    });
    directDelivered = (alertResult?.successCount ?? 0) > 0;
  }

  if (!userId) return;

  const tasks: Promise<void>[] = [
    sendInAppNotification({
      userId,
      title: input.title,
      body: input.body,
      recipientRole: 'seller',
      data: input.data,
    }),
  ];

  if (!directDelivered) {
    tasks.push(
      sendPushNotification({
        userId,
        title: input.title,
        body: input.body,
        eventKey: input.eventKey,
        recipientRole: 'seller',
        priority: 'high',
        data: input.data,
      }),
    );
  }

  await Promise.all(tasks);
}

/**
 * Notify a seller when an admin approves, rejects, or requests changes on their onboarding.
 * Sends direct FCM push, persists an in-app notification record, and falls back to the
 * notification-service when no Seller.fcmTokens are registered or direct send fails.
 */
export async function notifySellerOnboardingStatus(input: {
  sellerUserId: string;
  sellerId: string;
  status: 'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED';
  comment?: string;
  fcmTokens?: string[];
}): Promise<void> {
  const copy = ONBOARDING_NOTIFICATION_COPY[input.status];
  const body =
    input.status === 'CHANGES_REQUIRED' || input.status === 'REJECTED'
      ? input.comment?.trim() || copy.defaultBody
      : copy.defaultBody;

  const data: Record<string, string> = {
    eventKey: copy.eventKey,
    type: copy.legacyType,
    sellerId: String(input.sellerId),
    status: input.status,
    title: copy.title,
    body,
    recipientRole: 'seller',
    ...(input.comment ? { comment: input.comment } : {}),
  };

  await deliverSellerStatusNotification({
    sellerUserId: input.sellerUserId,
    sellerId: input.sellerId,
    title: copy.title,
    body,
    eventKey: copy.eventKey,
    fcmTokens: input.fcmTokens,
    data,
  });
}

const PRODUCT_REVIEW_COPY: Record<
  'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED',
  { eventKey: string; title: string; defaultBody: (name: string) => string }
> = {
  APPROVED: {
    eventKey: 'QC_PRODUCT_APPROVED',
    title: 'Product Approved!',
    defaultBody: (name) => `${name} has been approved and is now available in your store.`,
  },
  CHANGES_REQUIRED: {
    eventKey: 'QC_PRODUCT_CHANGES_REQUIRED',
    title: 'Product Update Required',
    defaultBody: (name) => `${name} needs a few updates before it can be approved. Please review the feedback and resubmit.`,
  },
  REJECTED: {
    eventKey: 'QC_PRODUCT_REJECTED',
    title: 'Product Not Approved',
    defaultBody: (name) => `${name} could not be approved. Please review the feedback in your product details.`,
  },
};

/**
 * Notify a seller when an admin approves, rejects, or requests changes on a
 * product submission or price/unit listing review.
 */
export async function notifySellerProductReview(input: {
  sellerId: string;
  productName: string;
  status: 'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED';
  comment?: string;
  submissionId?: string;
  listingId?: string;
  source?: 'submission' | 'listing';
}): Promise<void> {
  try {
    const { default: Seller } = await import('../models/Seller');
    const seller = await Seller.findById(input.sellerId).select('userId fcmTokens').lean();
    if (!seller) return;

    const name = input.productName?.trim() || 'Your product';
    const copy = PRODUCT_REVIEW_COPY[input.status];
    const trimmedComment = input.comment?.trim();
    const body =
      (input.status === 'CHANGES_REQUIRED' || input.status === 'REJECTED') && trimmedComment
        ? `${name}: ${trimmedComment}`
        : copy.defaultBody(name);

    const data: Record<string, string> = {
      eventKey: copy.eventKey,
      type: copy.eventKey,
      sellerId: String(input.sellerId),
      status: input.status,
      productName: name,
      title: copy.title,
      body,
      recipientRole: 'seller',
      ...(input.source ? { source: input.source } : {}),
      ...(input.submissionId ? { submissionId: input.submissionId } : {}),
      ...(input.listingId ? { listingId: input.listingId } : {}),
      ...(trimmedComment ? { comment: trimmedComment } : {}),
    };

    await deliverSellerStatusNotification({
      sellerUserId: String(seller.userId || ''),
      sellerId: String(input.sellerId),
      title: copy.title,
      body,
      eventKey: copy.eventKey,
      fcmTokens: seller.fcmTokens ?? [],
      data,
    });
  } catch (err) {
    logger.warn('notifySellerProductReview failed (non-fatal)', {
      err,
      sellerId: input.sellerId,
      status: input.status,
      submissionId: input.submissionId,
      listingId: input.listingId,
    });
  }
}

/** Notify seller when inventory reaches low stock threshold. */
export async function notifySellerLowStock(input: {
  sellerId?: string;
  sellerUserId?: string;
  orderNumber?: string;
  products: Array<{ name: string; listingId?: string }>;
  fcmTokens?: string[];
}): Promise<void> {
  const products = (input.products || []).filter((p) => p?.name?.trim());
  if (products.length === 0) return;
  const names = products.map((p) => p.name.trim());
  const title = 'Low Stock Alert';
  const body =
    names.length === 1
      ? `${names[0]} is running low on stock. Consider restocking soon.`
      : `${names.length} products are running low on stock. Restock them soon to avoid missing orders.`;

  await dispatchSellerAlert({
    sellerId: input.sellerId,
    sellerUserId: input.sellerUserId,
    fcmTokens: input.fcmTokens,
    eventKey: 'QC_STOCK_LOW',
    title,
    body,
    data: {
      productNames: names,
      ...(input.orderNumber ? { orderNumber: input.orderNumber } : {}),
      ...(products[0]?.listingId ? { listingId: products[0].listingId } : {}),
    },
  });
}

/** Notify seller of staff activity on an order. */
export async function notifySellerStaffOrderActivity(input: {
  sellerId: string;
  orderId: string;
  orderNumber: string;
  staffName?: string;
  action: string;
  itemName?: string;
}): Promise<void> {
  const staff = input.staffName || 'Staff';
  const title = 'Staff Updated an Order';
  const body = `${staff} updated order #${input.orderNumber}.`;

  await dispatchSellerAlert({
    sellerId: input.sellerId,
    eventKey: 'QC_STAFF_ORDER_ACTIVITY',
    title,
    body,
    data: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      action: input.action,
      staffName: staff,
      ...(input.itemName ? { itemName: input.itemName } : {}),
    },
  });
}

/** Notify seller of staff approval request. */
export async function notifySellerStaffApprovalRequest(input: {
  sellerId: string;
  staffName: string;
}): Promise<void> {
  const title = 'New Staff Access Request';
  const body = `${input.staffName} has requested access to your store. Review the request to approve or reject it.`;

  await dispatchSellerAlert({
    sellerId: input.sellerId,
    eventKey: 'QC_STAFF_APPROVAL_REQUEST',
    title,
    body,
    data: { staffName: input.staffName },
  });
}

/** Notify seller when customer review or rating arrives. */
export async function notifySellerCustomerReview(input: {
  sellerId: string;
  orderId: string;
  orderNumber: string;
  rating: number | null;
}): Promise<void> {
  const starText = input.rating != null ? `${input.rating}` : 'new';
  const title = 'New Customer Review';
  const body = `You received a ${starText}-star rating for order #${input.orderNumber}. Thank you for serving our customers.`;

  await dispatchSellerAlert({
    sellerId: input.sellerId,
    eventKey: 'QC_CUSTOMER_REVIEW',
    title,
    body,
    data: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      rating: input.rating != null ? String(input.rating) : '',
    },
  });
}

/** Notify seller of store status change (e.g. open/closed/paused). */
export async function notifySellerStoreStatusChange(input: {
  sellerId: string;
  status: string;
  statusMessage?: string;
}): Promise<void> {
  const title = 'Store Status Updated';
  const body = `Your store is now ${input.status}.${input.statusMessage ? ` ${input.statusMessage}` : ''}`;

  await dispatchSellerAlert({
    sellerId: input.sellerId,
    eventKey: 'QC_STORE_STATUS_CHANGE',
    title,
    body,
    data: {
      status: input.status,
      ...(input.statusMessage ? { statusMessage: input.statusMessage } : {}),
    },
  });
}

/**
 * Notify seller when delivery partner is assigned to an order — exactly once.
 * Claims `partnerAssignedNotifiedAt` atomically in MongoDB so multiple change-stream
 * events, partial updates, or clustered backend instances do not send duplicate pushes.
 */
export async function notifySellerPartnerAssigned(input: {
  sellerId: string;
  orderId: string;
  orderNumber: string;
  partnerName?: string;
}): Promise<boolean> {
  const { Types } = await import('mongoose');
  if (!Types.ObjectId.isValid(input.orderId)) return false;

  const { default: CustomerOrder } = await import('../models/CustomerOrder');

  // Atomic claim: only the first caller for this order gets the document back.
  const claimed = await CustomerOrder.findOneAndUpdate(
    {
      _id: input.orderId,
      partnerAssignedNotifiedAt: { $exists: false },
    },
    {
      $set: { partnerAssignedNotifiedAt: new Date() },
    },
    { new: true },
  );

  if (!claimed) {
    return false;
  }

  const partner =
    input.partnerName ||
    claimed.partnerName ||
    (claimed.assignedHelperName as string | undefined) ||
    'Delivery Partner';
  const title = 'Delivery Partner Assigned';
  const body = `${partner} has been assigned to pick up order #${input.orderNumber}.`;

  await dispatchSellerAlert({
    sellerId: input.sellerId,
    eventKey: 'QC_PARTNER_ASSIGNED',
    title,
    body,
    data: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      partnerName: partner,
      recipientRole: 'seller',
      role: 'seller',
    },
  });

  return true;
}






