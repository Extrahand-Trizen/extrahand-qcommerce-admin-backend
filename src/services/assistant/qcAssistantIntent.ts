export type QcAssistantIntent =
  | 'ORDER_STATUS'
  | 'ORDER_DETAILS'
  | 'CANCEL_ORDER'
  | 'REQUEST_CANCEL'
  | 'CONFIRM_CANCEL'
  | 'KEEP_ORDER'
  | 'CANCEL_WHY'
  | 'REFUND_STATUS'
  | 'PAYMENT'
  | 'PAYMENT_MENU'
  | 'DELIVERY'
  | 'DELIVERY_MENU'
  | 'PRODUCT_ISSUE'
  | 'PRODUCT_MENU'
  | 'FAQ_GENERAL'
  | 'CONTACT_SUPPORT'
  | 'FREE_TEXT'
  | 'MAIN_MENU'
  | 'END_CHAT'
  | 'UNKNOWN';

function normalizeMessage(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\w\s₹]/g, ' ')
    .replace(/\s+/g, ' ');
}

const INTENT_PATTERNS: Array<{ intent: QcAssistantIntent; patterns: RegExp[] }> = [
  {
    intent: 'END_CHAT',
    patterns: [/^__end_chat__$/, /\bend chat\b/, /\bend this chat\b/, /\bclose chat\b/],
  },
  {
    intent: 'MAIN_MENU',
    patterns: [
      /^__main_menu__$/,
      /\bback to help options\b/,
      /\bhelp options\b/,
      /\bmain menu\b/,
    ],
  },
  {
    intent: 'FREE_TEXT',
    patterns: [/^__free_text__$/, /\bsomething else\b/, /\bask something else\b/],
  },
  {
    intent: 'CONFIRM_CANCEL',
    patterns: [
      /^__confirm_cancel__$/,
      /\byes[, ]?\s*(please\s+)?cancel (the |this |my )?order\b/,
      /\byes[, ]?cancel\b/,
      /\bgo ahead and cancel\b/,
    ],
  },
  {
    intent: 'REQUEST_CANCEL',
    patterns: [/^__request_cancel__$/, /\brequest cancel\b/],
  },
  {
    intent: 'KEEP_ORDER',
    patterns: [
      /^__keep_order__$/,
      /\bkeep (the |this |my )?order\b/,
      /\bdont cancel\b/,
      /\bno[, ]?\s*(thanks|thank you)?\s*(keep|dont)\b/,
    ],
  },
  {
    intent: 'CANCEL_WHY',
    patterns: [/^__cancel_why__$/, /\bwhy (cant|cannot|can i not) cancel\b/, /^why\??$/],
  },
  {
    intent: 'CONTACT_SUPPORT',
    patterns: [
      /\bcontact support\b/,
      /\btalk to (a )?human\b/,
      /\bcall support\b/,
      /\bcustomer (care|service|support)\b/,
    ],
  },
  {
    intent: 'REFUND_STATUS',
    patterns: [
      /\bwhere.*(is|are).*refund\b/,
      /\brefund status\b/,
      /\brefund (not|pending|received|come|coming)\b/,
      /\bmoney (not|back)\b/,
      /\bwhen.*(will|do).*refund\b/,
    ],
  },
  {
    intent: 'CANCEL_ORDER',
    patterns: [
      /\bcan i cancel\b/,
      /\bcancel my order\b/,
      /\bi want to cancel\b/,
      /\bcancellable\b/,
    ],
  },
  {
    intent: 'ORDER_STATUS',
    patterns: [
      /\bwhere is my order\b/,
      /\bwheres my order\b/,
      /\btrack( my)? order\b/,
      /\border status\b/,
      /\bwhen will (it|my order) arrive\b/,
      /\bout for delivery\b/,
      /\bon the way\b/,
      /\border hasnt arrived\b/,
      /\border has not arrived\b/,
      /\border is late\b/,
    ],
  },
  {
    intent: 'ORDER_DETAILS',
    patterns: [
      /\border details?\b/,
      /\bview order\b/,
      /\bwhat(s| is) in my order\b/,
      /\border (number|id|amount|total)\b/,
    ],
  },
  {
    intent: 'PAYMENT_MENU',
    patterns: [/^payment issue$/, /\bpayment issue\b/],
  },
  {
    intent: 'PAYMENT',
    patterns: [
      /\bpayment failed\b/,
      /\bmoney (was )?deducted\b/,
      /\bpayment (was )?cancelled\b/,
      /\bpayment (problem|pending)\b/,
      /\bpaid but\b/,
      /\brazorpay\b/,
      /\bpayment method\b/,
      /\bhow (do i|to) pay\b/,
    ],
  },
  {
    intent: 'PRODUCT_MENU',
    patterns: [/^product issue$/, /\bproduct issue\b/],
  },
  {
    intent: 'PRODUCT_ISSUE',
    patterns: [
      /\bmissing (item|product)\b/,
      /\bwrong (item|product)\b/,
      /\bdamaged\b/,
      /\bspoiled\b/,
      /\bquality\b/,
    ],
  },
  {
    intent: 'DELIVERY_MENU',
    patterns: [/^delivery issue$/, /\bdelivery issue\b/],
  },
  {
    intent: 'DELIVERY',
    patterns: [
      /\bdelivery (problem|late|delay)\b/,
      /\blate delivery\b/,
      /\bhow (fast|far|long).*deliver\b/,
      /\bstore unavailable\b/,
      /\border is late\b/,
      /\bhasnt arrived\b/,
      /\bhas not arrived\b/,
    ],
  },
  {
    intent: 'FAQ_GENERAL',
    patterns: [
      /\bwhat is quick commerce\b/,
      /\bhow does (delivery|this) work\b/,
      /\bfeedback\b/,
      /\bsuggestion\b/,
    ],
  },
];

/**
 * Deterministic intent classifier for QC Assistant V1 (no LLM).
 */
export function detectQcAssistantIntent(message: string): QcAssistantIntent {
  const text = normalizeMessage(message);
  if (!text) return 'UNKNOWN';

  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((re) => re.test(text))) {
      return intent;
    }
  }

  if (/\b(refund|payment|deliver|cancel|order|store|track|item|product)\b/.test(text)) {
    return 'FAQ_GENERAL';
  }

  return 'UNKNOWN';
}

export function normalizeQcAssistantMessage(message: string): string {
  return normalizeMessage(message);
}
