import { env } from '../config/env';

type NotifySellerNewOrderInput = {
  sellerUserId: string;
  sellerId: string;
  orderId: string;
  orderNumber: string;
  amountRupees: number;
  itemCount: number;
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
  if (!baseUrl || !env.SERVICE_AUTH_TOKEN) return;

  await fetch(`${baseUrl}/api/v1/notifications/in-app/send`, {
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
  }).catch(() => undefined);
}

async function sendPushNotification(payload: {
  userId: string;
  title: string;
  body: string;
  eventKey: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const baseUrl = notificationServiceBaseUrl();
  if (!baseUrl || !env.SERVICE_AUTH_TOKEN) return;

  await fetch(`${baseUrl}/api/v1/notifications/send`, {
    method: 'POST',
    headers: serviceAuthHeaders(),
    body: JSON.stringify({
      recipients: [payload.userId],
      eventKey: payload.eventKey,
      category: 'orders',
      title: payload.title,
      body: payload.body,
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
  }).catch(() => undefined);
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
    }),
  ]);
}
