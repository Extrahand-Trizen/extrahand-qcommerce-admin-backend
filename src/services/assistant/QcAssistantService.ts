import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import QcAssistantConversation, {
  IQcAssistantConversation,
  IQcAssistantMessage,
} from '../../models/QcAssistantConversation';
import { AppError } from '../../utils/response';
import {
  detectQcAssistantIntent,
  normalizeQcAssistantMessage,
  type QcAssistantIntent,
} from './qcAssistantIntent';
import { findBestFaqAnswer } from './qcAssistantFaqKnowledge';
import { QcAssistantTools, type SafeOrderSummary } from './QcAssistantTools';

export type AssistantActionId =
  | 'request_cancel'
  | 'confirm_cancel'
  | 'keep_order'
  | 'contact_support'
  | 'try_again'
  | 'track_order'
  | 'view_order'
  | 'main_menu'
  | 'free_text'
  | 'cancel_why'
  | 'end_chat';

export type AssistantAction = {
  id: AssistantActionId;
  label: string;
};

export type AssistantOption = {
  id: string;
  label: string;
};

export type AssistantReplyPayload = {
  intent: QcAssistantIntent | 'WELCOME' | 'ERROR';
  type: string;
  message: string;
  data?: Record<string, unknown>;
  actions?: AssistantAction[];
  /** Guided selectable options (preferred over free typing). */
  options?: AssistantOption[];
  suggestions?: string[];
  showSupportFallback?: boolean;
  /** guided = options only; free_text = reveal keyboard input */
  uiMode?: 'guided' | 'free_text';
};

const SUPPORT_CONTACTS = {
  email: 'support@extrahand.in',
  phone: '+917710247365',
  chatUrl: 'https://support.extrahand.in',
};

export const MAIN_MENU_OPTIONS: AssistantOption[] = [
  { id: 'order_status', label: 'Where is my order?' },
  { id: 'cancel', label: 'Can I cancel my order?' },
  { id: 'payment', label: 'Payment issue' },
  { id: 'refund', label: 'Refund status' },
  { id: 'delivery', label: 'Delivery issue' },
  { id: 'product', label: 'Product issue' },
  { id: 'something_else', label: 'Something else' },
  { id: 'end_chat', label: 'End chat' },
];

const PAYMENT_OPTIONS: AssistantOption[] = [
  { id: 'payment_failed', label: 'Payment failed' },
  { id: 'money_deducted', label: 'Money was deducted' },
  { id: 'payment_cancelled', label: 'Payment was cancelled' },
  { id: 'something_else', label: 'Something else' },
];

const DELIVERY_OPTIONS: AssistantOption[] = [
  { id: 'order_late', label: 'Order is late' },
  { id: 'not_arrived', label: "Order hasn't arrived" },
  { id: 'delivery_problem', label: 'Delivery problem' },
  { id: 'something_else', label: 'Something else' },
];

const PRODUCT_OPTIONS: AssistantOption[] = [
  { id: 'missing', label: 'Missing item' },
  { id: 'wrong', label: 'Wrong item' },
  { id: 'damaged', label: 'Damaged item' },
  { id: 'quality', label: 'Product quality issue' },
];

const WELCOME_TEXT = 'How can we help you with this order?';

function welcomeForOrder(order?: {
  orderNumber?: string;
  statusLabel?: string;
  status?: string;
  fulfillmentStatus?: string;
} | null): string {
  const number = String(order?.orderNumber || '').trim();
  const status =
    String(order?.statusLabel || '').trim() ||
    String(order?.status || '')
      .replace(/_/g, ' ')
      .toLowerCase();
  if (number && status) {
    return `You're chatting about order ${number} (${status}). How can we help?`;
  }
  if (number) {
    return `You're chatting about order ${number}. How can we help?`;
  }
  return WELCOME_TEXT;
}

const MAIN_MENU_ACTION: AssistantAction = { id: 'main_menu', label: 'Back to Help Options' };
const FREE_TEXT_ACTION: AssistantAction = { id: 'free_text', label: 'Something else' };
const END_CHAT_ACTION: AssistantAction = { id: 'end_chat', label: 'End chat' };

function withMainMenuNav(options?: AssistantOption[]): AssistantOption[] {
  const base = options && options.length > 0 ? [...options] : [...MAIN_MENU_OPTIONS];
  const hasSomethingElse = base.some((o) => /something else/i.test(o.label));
  const hasEnd = base.some((o) => /end chat/i.test(o.label) || o.id === 'end_chat');
  if (!hasSomethingElse) base.push({ id: 'something_else', label: 'Something else' });
  if (!hasEnd) base.push({ id: 'end_chat', label: 'End chat' });
  return base;
}

function optionLabels(options: AssistantOption[]): string[] {
  return options.map((o) => o.label);
}

function formatInr(amount: number): string {
  return `₹${Number(amount || 0).toFixed(2)}`;
}

function formatDateTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return undefined;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function humanRefundStatus(status: string): string {
  const key = String(status || '').toUpperCase();
  if (key === 'ISSUED') return 'Completed';
  if (key === 'PENDING') return 'Processing';
  if (key === 'FAILED') return 'Failed';
  return status || 'Unknown';
}

function buildOrderSnapshot(order: SafeOrderSummary): string {
  const lines = [
    `Order ${order.orderNumber}`,
    `Status: ${statusLabel(order)}`,
    `Payment: ${order.paymentStatus}${order.paymentMethod ? ` (${order.paymentMethod})` : ''}`,
    `Amount: ${formatInr(order.amount)}`,
  ];
  if (order.shopName) lines.push(`Store: ${order.shopName}`);
  if (order.itemCount > 0) {
    const names =
      order.itemNames.length > 0
        ? order.itemNames.join(', ') + (order.itemCount > order.itemNames.length ? '…' : '')
        : `${order.itemCount} item(s)`;
    lines.push(`Items: ${names}`);
  }
  const placed = formatDateTime(order.createdAt);
  if (placed) lines.push(`Placed: ${placed}`);
  if (order.cancelledAt) {
    const cancelled = formatDateTime(order.cancelledAt);
    if (cancelled) lines.push(`Cancelled: ${cancelled}`);
  }
  if (order.cancellationReason) lines.push(`Cancel reason: ${order.cancellationReason}`);
  return lines.join('\n');
}

function statusLabel(order: SafeOrderSummary): string {
  const status = String(order.status || '').toUpperCase();
  const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
  const phase = String(order.executionPhase || '').toLowerCase();

  if (status === 'CANCELLED' || fulfillment === 'CANCELLED') return 'Cancelled';
  if (status === 'FAILED' || fulfillment === 'REJECTED') return 'Failed';
  if (status === 'DELIVERED' || status === 'COMPLETED' || fulfillment === 'COMPLETED') {
    return 'Delivered';
  }
  if (phase === 'arrived' || fulfillment === 'HANDED_OVER' || status === 'CONFIRMED') {
    return 'Out for delivery';
  }
  if (fulfillment === 'PREPARING' || fulfillment === 'READY') return 'Being prepared';
  if (fulfillment === 'ACCEPTED' || fulfillment === 'PENDING_ACCEPT') return 'Confirmed with store';
  if (status === 'PENDING_PAYMENT' || order.paymentStatus === 'PENDING') return 'Awaiting payment';
  return status || 'In progress';
}

function formatConversation(doc: IQcAssistantConversation) {
  return {
    conversationId: doc.conversationId,
    customerUserId: doc.customerUserId,
    orderId: doc.orderId ? String(doc.orderId) : undefined,
    status: doc.status,
    messages: (doc.messages || []).map((m) => ({
      role: m.role,
      text: m.text,
      intent: m.intent,
      createdAt: m.createdAt,
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function pushMessage(
  doc: IQcAssistantConversation,
  role: IQcAssistantMessage['role'],
  text: string,
  intent?: string,
) {
  doc.messages.push({
    role,
    text,
    intent,
    createdAt: new Date(),
  });
}

function supportPayload(
  intent: QcAssistantIntent,
  message: string,
  extra?: Partial<AssistantReplyPayload>,
): AssistantReplyPayload {
  const options = withMainMenuNav([
    { id: 'contact_support', label: 'Contact Support' },
    { id: 'something_else', label: 'Something else' },
  ]);
  return {
    intent,
    type: 'support_fallback',
    message,
    showSupportFallback: true,
    uiMode: 'guided',
    data: { support: SUPPORT_CONTACTS },
    options,
    suggestions: optionLabels(options),
    actions: [
      { id: 'contact_support', label: 'Contact Support' },
      MAIN_MENU_ACTION,
    ],
    ...extra,
  };
}

function mainMenuPayload(message = WELCOME_TEXT): AssistantReplyPayload {
  return {
    intent: 'MAIN_MENU',
    type: 'main_menu',
    message,
    uiMode: 'guided',
    options: MAIN_MENU_OPTIONS,
    suggestions: optionLabels(MAIN_MENU_OPTIONS),
  };
}

export class QcAssistantService {
  static async createOrResumeConversation(customerUserId: string, orderId?: string) {
    if (!customerUserId) throw new AppError('Authentication required', 401);

    let orderObjectId: mongoose.Types.ObjectId | undefined;
    if (orderId) {
      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        throw new AppError('Order not found', 404);
      }
      await QcAssistantTools.getOrderDetails(orderId, customerUserId);
      orderObjectId = new mongoose.Types.ObjectId(orderId);
    }

    const existing = await QcAssistantConversation.findOne({
      customerUserId,
      status: 'open',
      ...(orderObjectId ? { orderId: orderObjectId } : { orderId: { $exists: false } }),
    }).sort({ updatedAt: -1 });

    if (existing) {
      let orderNumber: string | undefined;
      let welcome = WELCOME_TEXT;
      if (orderId) {
        try {
          const order = await QcAssistantTools.getOrderDetails(orderId, customerUserId);
          orderNumber = order.orderNumber;
          welcome = welcomeForOrder({
            orderNumber: order.orderNumber,
            status: order.status,
            fulfillmentStatus: order.fulfillmentStatus,
          });
        } catch {
          orderNumber = undefined;
        }
      }
      return {
        conversation: formatConversation(existing),
        resumed: true,
        welcome,
        orderId,
        orderNumber,
        options: MAIN_MENU_OPTIONS,
        suggestions: optionLabels(MAIN_MENU_OPTIONS),
        uiMode: 'guided' as const,
        payload: mainMenuPayload(
          existing.messages.length > 1
            ? welcomeForOrder({ orderNumber })
            : welcome,
        ),
      };
    }

    const conversationId = uuidv4();
    let orderNumber: string | undefined;
    let welcome = WELCOME_TEXT;
    if (orderId) {
      try {
        const order = await QcAssistantTools.getOrderDetails(orderId, customerUserId);
        orderNumber = order.orderNumber;
        welcome = welcomeForOrder({
          orderNumber: order.orderNumber,
          status: order.status,
          fulfillmentStatus: order.fulfillmentStatus,
        });
      } catch {
        orderNumber = undefined;
      }
    }
    const doc = await QcAssistantConversation.create({
      conversationId,
      customerUserId,
      orderId: orderObjectId,
      status: 'open',
      messages: [
        {
          role: 'assistant',
          text: welcome,
          intent: 'WELCOME',
          createdAt: new Date(),
        },
      ],
    });

    return {
      conversation: formatConversation(doc),
      resumed: false,
      welcome,
      orderId,
      orderNumber,
      options: MAIN_MENU_OPTIONS,
      suggestions: optionLabels(MAIN_MENU_OPTIONS),
      uiMode: 'guided' as const,
      payload: mainMenuPayload(welcome),
    };
  }

  static async getConversation(customerUserId: string, conversationId: string) {
    const doc = await QcAssistantConversation.findOne({
      conversationId,
      customerUserId,
    });
    if (!doc) throw new AppError('Conversation not found', 404);
    return { conversation: formatConversation(doc) };
  }

  static async endConversation(customerUserId: string, conversationId: string) {
    const doc = await QcAssistantConversation.findOne({
      conversationId,
      customerUserId,
    });
    if (!doc) throw new AppError('Conversation not found', 404);
    if (doc.status !== 'closed') {
      pushMessage(doc, 'assistant', 'This chat has ended. You can open help again anytime.', 'END_CHAT');
      doc.status = 'closed';
      await doc.save();
    }
    return {
      conversation: formatConversation(doc),
      payload: {
        intent: 'END_CHAT' as const,
        type: 'chat_ended',
        message: 'This chat has ended. You can open help again anytime.',
        uiMode: 'guided' as const,
        options: [],
        suggestions: [],
      },
    };
  }

  static async postMessage(
    customerUserId: string,
    conversationId: string,
    rawText: string,
  ) {
    const text = String(rawText || '').trim();
    if (!text) throw new AppError('Message is required', 400);
    if (text.length > 2000) throw new AppError('Message is too long', 400);

    const doc = await QcAssistantConversation.findOne({
      conversationId,
      customerUserId,
    });
    if (!doc) throw new AppError('Conversation not found', 404);
    if (doc.status === 'closed') {
      throw new AppError('This conversation is closed', 409);
    }

    const orderId = doc.orderId ? String(doc.orderId) : undefined;
    const intent = detectQcAssistantIntent(text);

    // Don't persist wire tokens as the visible user text when display is handled client-side;
    // still store a readable label for history.
    const storedUserText = sanitizeStoredUserText(text);
    pushMessage(doc, 'user', storedUserText, intent);

    let reply: AssistantReplyPayload;
    try {
      reply = await this.routeIntent(intent, text, customerUserId, orderId);
    } catch (e) {
      reply = this.errorReply(intent, e);
    }

    pushMessage(doc, 'assistant', reply.message, String(reply.intent));
    if (intent === 'END_CHAT' || reply.type === 'chat_ended') {
      doc.status = 'closed';
    }
    await doc.save();

    return {
      conversation: formatConversation(doc),
      assistantMessage: {
        role: 'assistant' as const,
        text: reply.message,
        intent: reply.intent,
        createdAt: doc.messages[doc.messages.length - 1]?.createdAt,
      },
      payload: reply,
      ended: doc.status === 'closed',
    };
  }

  private static errorReply(
    intent: QcAssistantIntent,
    e: unknown,
  ): AssistantReplyPayload {
    const options = withMainMenuNav([
      { id: 'try_again', label: 'Try again' },
      { id: 'contact_support', label: 'Contact Support' },
    ]);
    if (e instanceof AppError) {
      if (e.statusCode === 404) {
        return {
          intent,
          type: 'error',
          message:
            'I could not find that order for your account. Please check the order and try again, or contact support.',
          showSupportFallback: true,
          uiMode: 'guided',
          data: { support: SUPPORT_CONTACTS },
          options,
          suggestions: optionLabels(options),
          actions: [
            { id: 'try_again', label: 'Try again' },
            { id: 'contact_support', label: 'Contact Support' },
            MAIN_MENU_ACTION,
          ],
        };
      }
      if (e.statusCode === 409) {
        return {
          intent,
          type: 'error',
          message: e.message,
          showSupportFallback: true,
          uiMode: 'guided',
          data: { support: SUPPORT_CONTACTS },
          options,
          suggestions: optionLabels(options),
          actions: [MAIN_MENU_ACTION],
        };
      }
    }
    return {
      intent,
      type: 'error',
      message:
        "Sorry, I couldn't get that information right now. Please try again or contact support.",
      showSupportFallback: true,
      uiMode: 'guided',
      data: { support: SUPPORT_CONTACTS },
      options,
      suggestions: optionLabels(options),
      actions: [
        { id: 'try_again', label: 'Try again' },
        { id: 'contact_support', label: 'Contact Support' },
        MAIN_MENU_ACTION,
      ],
    };
  }

  private static async routeIntent(
    intent: QcAssistantIntent,
    message: string,
    customerUserId: string,
    orderId?: string,
  ): Promise<AssistantReplyPayload> {
    switch (intent) {
      case 'MAIN_MENU':
        return mainMenuPayload();
      case 'END_CHAT':
        return {
          intent: 'END_CHAT',
          type: 'chat_ended',
          message: 'This chat has ended. You can open help again anytime.',
          uiMode: 'guided',
          options: [],
          suggestions: [],
          actions: [END_CHAT_ACTION],
        };
      case 'FREE_TEXT':
        return {
          intent: 'FREE_TEXT',
          type: 'free_text',
          message: 'What else can I help you with?',
          uiMode: 'free_text',
          options: [
            { id: 'main_menu', label: 'Back to Help Options' },
            { id: 'end_chat', label: 'End chat' },
          ],
          suggestions: ['Back to Help Options', 'End chat'],
          actions: [MAIN_MENU_ACTION, END_CHAT_ACTION],
        };
      case 'ORDER_STATUS':
        return this.handleOrderStatus(customerUserId, orderId);
      case 'ORDER_DETAILS':
        return this.handleOrderDetails(customerUserId, orderId);
      case 'CANCEL_ORDER':
        return this.handleCancelEligibility(customerUserId, orderId);
      case 'REQUEST_CANCEL':
        return this.handleRequestCancel(customerUserId, orderId);
      case 'CONFIRM_CANCEL':
        return this.handleConfirmCancel(customerUserId, orderId);
      case 'KEEP_ORDER':
        return {
          intent,
          type: 'cancel_kept',
          message: 'Okay — your order has not been cancelled.',
          uiMode: 'guided',
          options: MAIN_MENU_OPTIONS,
          suggestions: optionLabels(MAIN_MENU_OPTIONS),
        };
      case 'CANCEL_WHY':
        return {
          intent,
          type: 'cancel_why',
          message:
            'Paid grocery orders can usually be cancelled only until the order is picked up for delivery. Once it is out for delivery, cancellation is no longer available.',
          uiMode: 'guided',
          options: withMainMenuNav([
            { id: 'order_status', label: 'Where is my order?' },
            { id: 'contact_support', label: 'Contact Support' },
          ]),
          suggestions: ['Where is my order?', 'Contact Support', 'Something else'],
          actions: [MAIN_MENU_ACTION],
        };
      case 'REFUND_STATUS':
        return this.handleRefund(customerUserId, orderId);
      case 'PAYMENT_MENU':
        return this.handlePaymentMenu();
      case 'PAYMENT':
        return this.handlePayment(message, customerUserId, orderId);
      case 'DELIVERY_MENU':
        return this.handleDeliveryMenu();
      case 'DELIVERY':
        return this.handleDelivery(message, customerUserId, orderId);
      case 'PRODUCT_MENU':
        return this.handleProductMenu();
      case 'PRODUCT_ISSUE':
        return this.handleProductIssue(message);
      case 'CONTACT_SUPPORT':
        return supportPayload(
          intent,
          'You can reach ExtraHand support by phone, email, or support chat.',
        );
      case 'FAQ_GENERAL':
        return this.handleFaq(message);
      case 'UNKNOWN':
      default:
        return this.handleUnknown(message);
    }
  }

  private static requireOrderId(orderId?: string): string {
    if (!orderId) {
      throw new AppError(
        'Open this assistant from an order to get order-specific help.',
        400,
      );
    }
    return orderId;
  }

  private static async handleOrderStatus(
    customerUserId: string,
    orderId?: string,
  ): Promise<AssistantReplyPayload> {
    const id = this.requireOrderId(orderId);
    const order = await QcAssistantTools.getOrderStatus(id, customerUserId);
    const label = statusLabel(order);
    const eta = order.etaEstimate;
    const snapshot = buildOrderSnapshot(order);

    let summary = `Here’s the latest for this order:\n\n${snapshot}`;
    if (label === 'Cancelled') {
      summary += '\n\nThis order is cancelled.';
      if (order.refunds.length > 0) {
        const latest = order.refunds[order.refunds.length - 1];
        summary += ` Refund: ${formatInr(latest.amount)} · ${humanRefundStatus(latest.status)}.`;
      } else if (order.paymentStatus === 'PAID') {
        summary += ' Choose Refund status for payment refund details.';
      }
    } else if (eta?.expectedAround) {
      const when = new Date(eta.expectedAround);
      const timeLabel = Number.isFinite(when.getTime())
        ? when.toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'Asia/Kolkata',
          })
        : undefined;
      if (timeLabel) {
        summary += `\n\nBased on the current order information, expected around ${timeLabel}.`;
      } else if (eta.remainingMinutes != null) {
        summary += `\n\nBased on the current order information, delivery is expected in about ${eta.remainingMinutes} minute(s).`;
      }
      summary += ` ${eta.disclaimer}`;
    } else if (eta) {
      summary += `\n\n${eta.disclaimer}`;
    }

    const options = withMainMenuNav([
      { id: 'track', label: 'Track Order' },
      { id: 'view', label: 'View Order' },
      { id: 'refund', label: 'Refund status' },
      { id: 'something_else', label: 'Something else' },
    ]);

    return {
      intent: 'ORDER_STATUS',
      type: 'order_status',
      message: summary,
      uiMode: 'guided',
      data: {
        status: order.status,
        orderNumber: order.orderNumber,
        fulfillmentStatus: order.fulfillmentStatus,
        executionPhase: order.executionPhase,
        eta: order.etaEstimate,
        label,
        orderId: order.id,
        order,
      },
      options,
      suggestions: optionLabels(options),
      actions: [
        { id: 'track_order', label: 'Track Order' },
        { id: 'view_order', label: 'View Order' },
        FREE_TEXT_ACTION,
        MAIN_MENU_ACTION,
        END_CHAT_ACTION,
      ],
    };
  }

  private static async handleOrderDetails(
    customerUserId: string,
    orderId?: string,
  ): Promise<AssistantReplyPayload> {
    const id = this.requireOrderId(orderId);
    const order = await QcAssistantTools.getOrderDetails(id, customerUserId);
    const snapshot = buildOrderSnapshot(order);
    const options = withMainMenuNav([
      { id: 'order_status', label: 'Where is my order?' },
      { id: 'refund', label: 'Refund status' },
      { id: 'view', label: 'View Order' },
      { id: 'something_else', label: 'Something else' },
    ]);

    return {
      intent: 'ORDER_DETAILS',
      type: 'order_details',
      message: `Here are the details for this order:\n\n${snapshot}`,
      uiMode: 'guided',
      data: { order },
      options,
      suggestions: optionLabels(options),
      actions: [
        { id: 'view_order', label: 'View Order' },
        MAIN_MENU_ACTION,
        END_CHAT_ACTION,
      ],
    };
  }

  private static async handleCancelEligibility(
    customerUserId: string,
    orderId?: string,
  ): Promise<AssistantReplyPayload> {
    const id = this.requireOrderId(orderId);
    const result = await QcAssistantTools.getCancelEligibility(id, customerUserId);
    if (result.eligible) {
      return {
        intent: 'CANCEL_ORDER',
        type: 'cancel_eligibility',
        message: `${result.message}`,
        uiMode: 'guided',
        data: { eligible: true, orderNumber: result.order.orderNumber },
        actions: [
          { id: 'request_cancel', label: 'Cancel Order' },
          { id: 'keep_order', label: 'Keep Order' },
        ],
        options: [
          { id: 'request_cancel', label: 'Cancel Order' },
          { id: 'keep_order', label: 'Keep Order' },
        ],
        suggestions: ['Cancel Order', 'Keep Order'],
      };
    }
    return {
      intent: 'CANCEL_ORDER',
      type: 'cancel_eligibility',
      message: result.message,
      uiMode: 'guided',
      data: {
        eligible: false,
        orderNumber: result.order.orderNumber,
        support: SUPPORT_CONTACTS,
      },
      options: withMainMenuNav([
        { id: 'why', label: 'Why?' },
        { id: 'something_else', label: 'Something else' },
      ]),
      suggestions: ['Why?', 'Something else'],
      actions: [
        { id: 'cancel_why', label: 'Why?' },
        FREE_TEXT_ACTION,
        MAIN_MENU_ACTION,
      ],
    };
  }

  private static async handleRequestCancel(
    customerUserId: string,
    orderId?: string,
  ): Promise<AssistantReplyPayload> {
    const id = this.requireOrderId(orderId);
    // Re-check eligibility before asking for confirmation.
    const result = await QcAssistantTools.getCancelEligibility(id, customerUserId);
    if (!result.eligible) {
      return this.handleCancelEligibility(customerUserId, orderId);
    }
    return {
      intent: 'REQUEST_CANCEL',
      type: 'cancel_confirm_prompt',
      message: 'Are you sure you want to cancel this order?',
      uiMode: 'guided',
      data: { eligible: true, orderNumber: result.order.orderNumber },
      actions: [
        { id: 'confirm_cancel', label: 'Yes, Cancel Order' },
        { id: 'keep_order', label: 'Keep Order' },
      ],
      options: [
        { id: 'confirm_cancel', label: 'Yes, Cancel Order' },
        { id: 'keep_order', label: 'Keep Order' },
      ],
      suggestions: ['Yes, Cancel Order', 'Keep Order'],
    };
  }

  private static async handleConfirmCancel(
    customerUserId: string,
    orderId?: string,
  ): Promise<AssistantReplyPayload> {
    const id = this.requireOrderId(orderId);
    const order = await QcAssistantTools.cancelOrder(
      id,
      customerUserId,
      'Cancelled via Quick Commerce Assistant',
    );
    const options = withMainMenuNav([
      { id: 'refund', label: 'Refund status' },
      { id: 'contact_support', label: 'Contact Support' },
    ]);
    return {
      intent: 'CONFIRM_CANCEL',
      type: 'cancel_confirmed',
      message: `Your order ${order.orderNumber} has been cancelled. If a refund applies, it will follow ExtraHand’s refund policy.`,
      uiMode: 'guided',
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
      },
      options,
      suggestions: optionLabels(options),
      actions: [MAIN_MENU_ACTION],
    };
  }

  private static async handleRefund(
    customerUserId: string,
    orderId?: string,
  ): Promise<AssistantReplyPayload> {
    const id = this.requireOrderId(orderId);
    const { order, hasRefundInfo, latestRefund } = await QcAssistantTools.getRefundStatus(
      id,
      customerUserId,
    );
    const snapshot = buildOrderSnapshot(order);

    if (!hasRefundInfo || !latestRefund) {
      const cancelled = statusLabel(order) === 'Cancelled';
      const options = withMainMenuNav([
        { id: 'try_again', label: 'Try again' },
        { id: 'contact_support', label: 'Contact Support' },
      ]);
      let message = `Here’s what we found for this order:\n\n${snapshot}\n\n`;
      if (cancelled && order.paymentStatus === 'PAID') {
        message +=
          'This order is cancelled and was paid, but detailed refund information is not available on the order yet. Please contact support if you were charged.';
      } else if (order.paymentStatus !== 'PAID') {
        message += 'This order is not marked as paid, so there is no refund to track.';
      } else {
        message +=
          "I couldn't find refund details for this order right now. Please try again or contact support.";
      }
      return {
        intent: 'REFUND_STATUS',
        type: 'refund_unavailable',
        message,
        uiMode: 'guided',
        showSupportFallback: true,
        data: { support: SUPPORT_CONTACTS, order },
        options,
        suggestions: optionLabels(options),
        actions: [
          { id: 'try_again', label: 'Try again' },
          { id: 'contact_support', label: 'Contact Support' },
          MAIN_MENU_ACTION,
          END_CHAT_ACTION,
        ],
      };
    }

    const refundLabel = humanRefundStatus(latestRefund.status);
    const refundAt = formatDateTime(latestRefund.at);
    const refundLines = [
      `Refund amount: ${formatInr(latestRefund.amount)}`,
      `Refund status: ${refundLabel}`,
    ];
    if (refundAt) refundLines.push(`Refund updated: ${refundAt}`);
    if (latestRefund.reason) refundLines.push(`Refund reason: ${latestRefund.reason}`);
    if (latestRefund.note) refundLines.push(`Note: ${latestRefund.note}`);

    let closing = '';
    const key = String(latestRefund.status || '').toUpperCase();
    if (key === 'ISSUED') {
      closing =
        '\n\nYour refund for this order is complete. It may still take a few business days to appear in your bank/UPI statement, depending on your payment provider.';
    } else if (key === 'PENDING') {
      closing =
        '\n\nYour refund is currently being processed. Bank timelines usually follow ExtraHand’s refund policy (often 5–7 business days).';
    } else if (key === 'FAILED') {
      closing =
        '\n\nThe refund attempt failed. Please contact support with this order number for help.';
    }

    const options = withMainMenuNav([
      { id: 'view', label: 'View Order' },
      { id: 'contact_support', label: 'Contact Support' },
      { id: 'something_else', label: 'Something else' },
    ]);
    return {
      intent: 'REFUND_STATUS',
      type: 'refund_status',
      message: `Here’s what we found for this order:\n\n${snapshot}\n\n${refundLines.join(
        '\n',
      )}${closing}`,
      uiMode: 'guided',
      showSupportFallback: key === 'FAILED',
      data: {
        orderNumber: order.orderNumber,
        order,
        refund: latestRefund,
        refunds: order.refunds,
        support: key === 'FAILED' ? SUPPORT_CONTACTS : undefined,
      },
      options,
      suggestions: optionLabels(options),
      actions: [
        { id: 'view_order', label: 'View Order' },
        MAIN_MENU_ACTION,
        END_CHAT_ACTION,
      ],
    };
  }

  private static handlePaymentMenu(): AssistantReplyPayload {
    return {
      intent: 'PAYMENT_MENU',
      type: 'payment_menu',
      message: 'What kind of payment issue are you facing?',
      uiMode: 'guided',
      options: PAYMENT_OPTIONS,
      suggestions: optionLabels(PAYMENT_OPTIONS),
      actions: [MAIN_MENU_ACTION],
    };
  }

  private static async handlePayment(
    message: string,
    customerUserId: string,
    orderId?: string,
  ): Promise<AssistantReplyPayload> {
    const normalized = normalizeQcAssistantMessage(message);

    if (orderId && /\b(fail|failed|deduct|cancelled|canceled|pending|problem)\b/.test(normalized)) {
      const order = await QcAssistantTools.getOrderDetails(orderId, customerUserId);
      const snapshot = buildOrderSnapshot(order);
      const options = withMainMenuNav([
        { id: 'refund', label: 'Refund status' },
        { id: 'contact_support', label: 'Contact Support' },
      ]);
      return {
        intent: 'PAYMENT',
        type: 'payment_status',
        message: `Here’s the payment information for this order:\n\n${snapshot}\n\nIf money was deducted but payment status is not PAID, contact support with this order number.`,
        uiMode: 'guided',
        data: {
          order,
          orderNumber: order.orderNumber,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          amount: order.amount,
          support: SUPPORT_CONTACTS,
        },
        showSupportFallback: order.paymentStatus !== 'PAID',
        options,
        suggestions: optionLabels(options),
        actions: [
          { id: 'contact_support', label: 'Contact Support' },
          MAIN_MENU_ACTION,
          END_CHAT_ACTION,
        ],
      };
    }

    const faq = findBestFaqAnswer(normalized);
    if (faq) {
      return {
        intent: 'PAYMENT',
        type: 'faq',
        message: faq.answer,
        uiMode: 'guided',
        data: { faqId: faq.id, question: faq.question },
        options: MAIN_MENU_OPTIONS,
        suggestions: optionLabels(MAIN_MENU_OPTIONS),
      };
    }

    return this.handlePaymentMenu();
  }

  private static handleDeliveryMenu(): AssistantReplyPayload {
    return {
      intent: 'DELIVERY_MENU',
      type: 'delivery_menu',
      message: 'What delivery issue are you facing?',
      uiMode: 'guided',
      options: DELIVERY_OPTIONS,
      suggestions: optionLabels(DELIVERY_OPTIONS),
      actions: [MAIN_MENU_ACTION],
    };
  }

  private static async handleDelivery(
    message: string,
    customerUserId: string,
    orderId?: string,
  ): Promise<AssistantReplyPayload> {
    const normalized = normalizeQcAssistantMessage(message);
    if (/\b(late|delay|problem|not arriv|hasnt arriv|has not arriv)\b/.test(normalized) && orderId) {
      const statusReply = await this.handleOrderStatus(customerUserId, orderId);
      return {
        ...statusReply,
        intent: 'DELIVERY',
        type: 'delivery_issue',
        message: `${statusReply.message} If delivery seems stuck, contact support with your order number.`,
        showSupportFallback: true,
        data: { ...(statusReply.data || {}), support: SUPPORT_CONTACTS },
        actions: [
          { id: 'track_order', label: 'Track Order' },
          { id: 'contact_support', label: 'Contact Support' },
          MAIN_MENU_ACTION,
        ],
      };
    }

    const faq = findBestFaqAnswer(normalized);
    if (faq) {
      return {
        intent: 'DELIVERY',
        type: 'faq',
        message: faq.answer,
        uiMode: 'guided',
        data: { faqId: faq.id, question: faq.question },
        options: MAIN_MENU_OPTIONS,
        suggestions: optionLabels(MAIN_MENU_OPTIONS),
      };
    }

    return this.handleDeliveryMenu();
  }

  private static handleProductMenu(): AssistantReplyPayload {
    return {
      intent: 'PRODUCT_MENU',
      type: 'product_menu',
      message: 'What product issue are you facing?',
      uiMode: 'guided',
      options: PRODUCT_OPTIONS,
      suggestions: optionLabels(PRODUCT_OPTIONS),
      actions: [MAIN_MENU_ACTION],
    };
  }

  private static handleProductIssue(message: string): AssistantReplyPayload {
    const normalized = normalizeQcAssistantMessage(message);
    // Top-level "Product issue" opens submenu; specific issues go to support.
    if (/^product issue$/.test(normalized) || normalized === 'product issue') {
      return this.handleProductMenu();
    }
    return supportPayload(
      'PRODUCT_ISSUE',
      "Sorry about that. We can help you with this issue through support. Please share your order number and details — I can't create a complaint ticket from this assistant yet.",
    );
  }

  private static handleFaq(message: string): AssistantReplyPayload {
    const faq = findBestFaqAnswer(normalizeQcAssistantMessage(message));
    if (faq) {
      return {
        intent: 'FAQ_GENERAL',
        type: 'faq',
        message: faq.answer,
        uiMode: 'guided',
        data: { faqId: faq.id, question: faq.question, category: faq.category },
        options: MAIN_MENU_OPTIONS,
        suggestions: optionLabels(MAIN_MENU_OPTIONS),
      };
    }
    return this.handleUnknown(message);
  }

  private static handleUnknown(message: string): AssistantReplyPayload {
    const faq = findBestFaqAnswer(normalizeQcAssistantMessage(message));
    if (faq) {
      return {
        intent: 'FAQ_GENERAL',
        type: 'faq',
        message: faq.answer,
        uiMode: 'guided',
        data: { faqId: faq.id, question: faq.question },
        options: MAIN_MENU_OPTIONS,
        suggestions: optionLabels(MAIN_MENU_OPTIONS),
      };
    }
    return supportPayload(
      'UNKNOWN',
      "I'm not sure how to help with that yet. Choose an option below, or contact support.",
      {
        type: 'unsupported',
        options: MAIN_MENU_OPTIONS,
        suggestions: optionLabels(MAIN_MENU_OPTIONS),
      },
    );
  }
}

function sanitizeStoredUserText(text: string): string {
  const map: Record<string, string> = {
    __CONFIRM_CANCEL__: 'Yes, Cancel Order',
    __REQUEST_CANCEL__: 'Cancel Order',
    __KEEP_ORDER__: 'Keep Order',
    __MAIN_MENU__: 'Back to Help Options',
    __FREE_TEXT__: 'Something else',
    __CANCEL_WHY__: 'Why?',
    __END_CHAT__: 'End chat',
  };
  const key = text.trim().toUpperCase();
  for (const [wire, label] of Object.entries(map)) {
    if (key === wire) return label;
  }
  return text;
}
