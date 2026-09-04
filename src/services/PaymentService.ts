import { env } from '../config/env';
import logger from '../config/logger';
import CustomerOrder from '../models/CustomerOrder';

export type RefundResult = {
  ok: boolean;
  refundId?: string;
  reason?: string;
};

/**
 * Refund an order in full and record it on `order.refunds[]`. Idempotent per
 * reason — a second call with the same reason while one is already ISSUED/PENDING
 * is a no-op. Used by both the accept-timeout auto-reject and a manual reject.
 */
export async function issueOrderRefund(
  orderId: string,
  reason: string,
): Promise<void> {
  const order = await CustomerOrder.findById(orderId);
  if (!order) return;
  if (order.paymentStatus !== 'PAID') return;

  const existing = order.refunds.find((r) => r.reason === reason && r.status !== 'FAILED');
  if (existing) return; // already refunding / refunded for this reason

  const now = new Date();
  order.refunds.push({ amountPaise: order.amountPaise, reason, status: 'PENDING', at: now });
  await order.save();

  const result = await refundPayment({
    razorpayPaymentId: order.razorpayPaymentId,
    amountPaise: order.amountPaise,
    notes: { orderNumber: order.orderNumber, reason: reason.toLowerCase() },
  });

  const fresh = await CustomerOrder.findById(orderId);
  if (!fresh) return;
  const rec = [...fresh.refunds].reverse().find((r) => r.reason === reason && r.status === 'PENDING');
  if (!rec) return;
  rec.status = result.ok ? 'ISSUED' : 'FAILED';
  if (result.refundId) rec.razorpayRefundId = result.refundId;
  if (!result.ok && result.reason) rec.note = result.reason;
  await fresh.save();
  logger.info('refund settled', { orderNumber: fresh.orderNumber, reason, status: rec.status });
}

/**
 * Ask the payment service to refund (all or part of) a captured Razorpay
 * payment. Multiple partial refunds against one payment are allowed as long as
 * their sum stays within the captured amount.
 *
 * No-ops with a logged warning when PAYMENT_SERVICE_URL is unset (local dev) or
 * when the order has no payment id — the caller still records the refund intent
 * on the order so it can be reconciled later.
 */
export async function refundPayment(input: {
  razorpayPaymentId?: string;
  amountPaise: number;
  notes?: Record<string, string>;
}): Promise<RefundResult> {
  const baseUrl = env.PAYMENT_SERVICE_URL?.trim();
  if (!baseUrl) {
    logger.warn('refundPayment: PAYMENT_SERVICE_URL unset — refund not issued', {
      amountPaise: input.amountPaise,
      notes: input.notes,
    });
    return { ok: false, reason: 'PAYMENT_SERVICE_UNSET' };
  }
  if (!input.razorpayPaymentId) {
    logger.warn('refundPayment: order has no razorpayPaymentId — cannot refund', {
      amountPaise: input.amountPaise,
      notes: input.notes,
    });
    return { ok: false, reason: 'NO_PAYMENT_ID' };
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/payment/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.SERVICE_AUTH_TOKEN ? { Authorization: `Bearer ${env.SERVICE_AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        razorpay_payment_id: input.razorpayPaymentId,
        amount: input.amountPaise,
        notes: input.notes,
      }),
    });

    if (!res.ok) {
      logger.error('refundPayment: payment service returned an error', {
        status: res.status,
        amountPaise: input.amountPaise,
      });
      return { ok: false, reason: `HTTP_${res.status}` };
    }

    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      refundId?: string;
      data?: { id?: string };
    };
    return { ok: true, refundId: body.refundId || body.id || body.data?.id };
  } catch (err) {
    logger.error('refundPayment: request failed', { err });
    return { ok: false, reason: 'REQUEST_FAILED' };
  }
}
