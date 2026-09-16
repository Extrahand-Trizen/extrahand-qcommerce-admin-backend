/**
 * FAQ knowledge for the QC Assistant — kept in sync with mobile
 * `qcHelpFaqData.ts`. Prefer updating both when copy changes.
 */
export type QcAssistantFaqEntry = {
  id: string;
  category: string;
  keywords: string[];
  question: string;
  answer: string;
};

export const QC_ASSISTANT_FAQ_ENTRIES: QcAssistantFaqEntry[] = [
  {
    id: 'delivery-speed',
    category: 'general-inquiry',
    keywords: ['how fast', 'delivery time', 'how long', 'minutes', 'quick commerce'],
    question: 'How fast is grocery delivery?',
    answer:
      'Most ExtraHand grocery orders are delivered within about 10–15 minutes, depending on store distance and traffic. Open Order status for live progress on your current order.',
  },
  {
    id: 'store-radius',
    category: 'general-inquiry',
    keywords: ['unavailable', 'not available', 'location', 'distance', 'far', 'store'],
    question: 'Why is the store unavailable at my location?',
    answer:
      'We deliver only from partner stores within about 3.5 km of your location. If none are nearby, change location or check back as we expand.',
  },
  {
    id: 'track-order',
    category: 'general-inquiry',
    keywords: ['track', 'live', 'map', 'where'],
    question: 'Can I track my order live?',
    answer:
      'Yes. After placing an order, open Order status to see delivery progress, ETA, and your delivery address.',
  },
  {
    id: 'payment-methods',
    category: 'payment-related',
    keywords: ['payment method', 'upi', 'card', 'net banking', 'razorpay', 'how to pay'],
    question: 'What payment methods are supported?',
    answer:
      'You can pay securely in-app using UPI, cards, and net banking via Razorpay.',
  },
  {
    id: 'closed-payment',
    category: 'payment-related',
    keywords: ['closed payment', 'dismissed', 'razorpay closed', 'without paying'],
    question: 'I closed the payment screen. Is my order cancelled?',
    answer:
      'Closing Razorpay without completing payment does not place a paid grocery order. Complete payment from cart again, or ask about cancelling if a paid order was already placed.',
  },
  {
    id: 'refund-timeline',
    category: 'payment-related',
    keywords: ['when refund', 'refund time', '5-7', 'business days'],
    question: 'When do refunds happen?',
    answer:
      'If a paid order is cancelled or fails, refunds are processed as per ExtraHand’s refund policy and usually reflect in 5–7 business days. Ask “Where is my refund?” for status on this order.',
  },
  {
    id: 'feedback',
    category: 'feedback-suggestions',
    keywords: ['feedback', 'suggestion', 'idea', 'improve'],
    question: 'How can I share feedback?',
    answer:
      'You can email support@extrahand.in or use Contact Support from this assistant. We review every suggestion.',
  },
  {
    id: 'product-request',
    category: 'feedback-suggestions',
    keywords: ['request product', 'add product', 'assortment'],
    question: 'Can I request products for my area?',
    answer:
      'Yes. Tell us the products and locality via Contact Support — we use requests to improve nearby store assortments.',
  },
  {
    id: 'missing-item',
    category: 'orders-product-related',
    keywords: ['missing', 'not received', 'item missing'],
    question: 'What if an item is missing?',
    answer:
      'We’re sorry about that. Please use Contact Support with your order number and the missing item name so our team can help. You can also share a photo of what you received.',
  },
  {
    id: 'damaged-wrong',
    category: 'orders-product-related',
    keywords: ['damaged', 'wrong item', 'quality', 'spoiled'],
    question: 'What if a product is wrong or damaged?',
    answer:
      'Please contact support with your order number and details of the issue. Photos help us resolve product quality problems faster.',
  },
  {
    id: 'cancel-faq',
    category: 'orders-product-related',
    keywords: ['how cancel', 'cancellation policy'],
    question: 'Can I cancel my grocery order?',
    answer:
      'Paid orders can usually be cancelled until the order is picked up for delivery. Ask “Can I cancel my order?” and I’ll check this order for you.',
  },
];

export function findBestFaqAnswer(normalizedMessage: string): QcAssistantFaqEntry | null {
  let best: QcAssistantFaqEntry | null = null;
  let bestScore = 0;
  for (const entry of QC_ASSISTANT_FAQ_ENTRIES) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (normalizedMessage.includes(kw)) score += 1;
    }
    if (normalizedMessage.includes(entry.question.toLowerCase().slice(0, 24))) {
      score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore > 0 ? best : null;
}
