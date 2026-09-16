import { QcOrderService, formatOrder } from '../QcOrderService';
import { AppError } from '../../utils/response';
import CustomerOrder from '../../models/CustomerOrder';

const QC_ESTIMATED_DELIVERY_MINS = 12;

export type SafeOrderSummary = {
  id: string;
  orderNumber: string;
  status: string;
  fulfillmentStatus?: string;
  paymentStatus: string;
  paymentMethod?: string;
  amount: number;
  createdAt: string;
  cancelledAt?: string;
  cancellationReason?: string;
  executionPhase?: string;
  shopName?: string;
  itemCount: number;
  itemNames: string[];
  etaEstimate?: {
    kind: 'approximate';
    minutesFromPlacement: number;
    expectedAround?: string;
    remainingMinutes?: number;
    disclaimer: string;
  };
  refunds: Array<{
    amount: number;
    status: string;
    reason?: string;
    at?: string;
    note?: string;
  }>;
};

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

function buildEta(order: {
  status?: string;
  fulfillmentStatus?: string;
  createdAt?: Date | string;
  readyBy?: Date | string;
}): SafeOrderSummary['etaEstimate'] | undefined {
  const status = String(order.status || '').toUpperCase();
  const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
  if (
    ['CANCELLED', 'FAILED', 'DELIVERED', 'COMPLETED'].includes(status) ||
    ['CANCELLED', 'COMPLETED', 'REJECTED'].includes(fulfillment)
  ) {
    return undefined;
  }

  const placed = order.createdAt ? new Date(order.createdAt).getTime() : NaN;
  if (!Number.isFinite(placed)) {
    return {
      kind: 'approximate',
      minutesFromPlacement: QC_ESTIMATED_DELIVERY_MINS,
      disclaimer:
        'Based on typical grocery delivery timing — this is an estimate, not a guarantee.',
    };
  }

  const etaAt = placed + QC_ESTIMATED_DELIVERY_MINS * 60_000;
  const remainingMs = etaAt - Date.now();
  const remainingMinutes =
    remainingMs <= 0 ? 1 : Math.max(1, Math.ceil(remainingMs / 60_000));

  // Prefer readyBy when present (seller prep), still framed as estimate.
  const readyByMs = order.readyBy ? new Date(order.readyBy).getTime() : NaN;
  const expectedAround = Number.isFinite(readyByMs)
    ? new Date(readyByMs).toISOString()
    : new Date(etaAt).toISOString();

  return {
    kind: 'approximate',
    minutesFromPlacement: QC_ESTIMATED_DELIVERY_MINS,
    expectedAround,
    remainingMinutes,
    disclaimer:
      'Based on the current order information, this is an estimate — not a guaranteed arrival time.',
  };
}

function summarizeFormattedOrder(order: ReturnType<typeof formatOrder>): SafeOrderSummary {
  const items = Array.isArray(order.items) ? order.items : [];
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    paymentStatus: order.paymentStatus,
    paymentMethod: (order as { paymentMethod?: string }).paymentMethod,
    amount: order.amount,
    createdAt: toIso(order.createdAt) || String(order.createdAt),
    executionPhase: order.executionPhase,
    shopName: order.shopName,
    itemCount: items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0),
    itemNames: items
      .slice(0, 5)
      .map((i) => String(i.name || '').trim())
      .filter(Boolean),
    etaEstimate: buildEta(order),
    refunds: (order.refunds || []).map((r) => ({
      amount: r.amount,
      status: r.status,
      reason: r.reason,
      at: toIso(r.at),
      note: r.note,
    })),
  };
}

/**
 * Controlled QC Assistant tools — always go through QcOrderService ownership checks.
 */
export class QcAssistantTools {
  static async getOrderDetails(orderId: string, customerId: string): Promise<SafeOrderSummary> {
    const { order } = await QcOrderService.getOrder(customerId, orderId);
    const summary = summarizeFormattedOrder(order);
    const lean = await CustomerOrder.findOne({ _id: orderId, userId: customerId })
      .select('cancelledAt cancellationReason')
      .lean();
    if (lean) {
      summary.cancelledAt = toIso((lean as { cancelledAt?: Date }).cancelledAt);
      const reason = String((lean as { cancellationReason?: string }).cancellationReason || '').trim();
      if (reason) summary.cancellationReason = reason;
    }
    return summary;
  }

  static async getOrderStatus(orderId: string, customerId: string): Promise<SafeOrderSummary> {
    return this.getOrderDetails(orderId, customerId);
  }

  static async getRefundStatus(
    orderId: string,
    customerId: string,
  ): Promise<{
    order: SafeOrderSummary;
    hasRefundInfo: boolean;
    latestRefund?: SafeOrderSummary['refunds'][number];
  }> {
    const order = await this.getOrderDetails(orderId, customerId);
    const latestRefund = order.refunds.length > 0 ? order.refunds[order.refunds.length - 1] : undefined;
    return {
      order,
      hasRefundInfo: order.refunds.length > 0,
      latestRefund,
    };
  }

  static async getCancelEligibility(
    orderId: string,
    customerId: string,
  ): Promise<{
    eligible: boolean;
    message: string;
    order: SafeOrderSummary;
  }> {
    const orderDoc = await CustomerOrder.findOne({ _id: orderId, userId: customerId });
    if (!orderDoc) throw new AppError('Order not found', 404);
    const eligibility = QcOrderService.canCustomerCancelOrder(orderDoc);
    const { order } = await QcOrderService.getOrder(customerId, orderId);
    const summary = summarizeFormattedOrder(order);
    if (eligibility.ok) {
      return {
        eligible: true,
        message: 'Your order can currently be cancelled.',
        order: summary,
      };
    }
    return {
      eligible: false,
      message:
        eligibility.message ||
        'This order can no longer be cancelled because it has already progressed beyond the cancellation stage.',
      order: summary,
    };
  }

  static async cancelOrder(
    orderId: string,
    customerId: string,
    reason?: string,
  ): Promise<SafeOrderSummary> {
    const { order } = await QcOrderService.cancelByCustomer(customerId, orderId, { reason });
    return summarizeFormattedOrder(order);
  }

  static async getInvoice(
    orderId: string,
    customerId: string,
  ): Promise<{ available: boolean; invoiceNumber?: string; message: string }> {
    try {
      const { invoice } = await QcOrderService.getInvoice(customerId, orderId);
      return {
        available: true,
        invoiceNumber: invoice.invoiceNumber,
        message: `Invoice ${invoice.invoiceNumber} is available for this paid order.`,
      };
    } catch (e) {
      if (e instanceof AppError) {
        return { available: false, message: e.message };
      }
      return {
        available: false,
        message: 'Invoice details are not available for this order right now.',
      };
    }
  }
}
