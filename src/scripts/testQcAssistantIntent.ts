/**
 * Minimal intent classifier smoke tests (no Jest harness required).
 * Run: npx ts-node --transpile-only src/scripts/testQcAssistantIntent.ts
 */
import { detectQcAssistantIntent } from '../services/assistant/qcAssistantIntent';

const cases: Array<{ input: string; expect: string }> = [
  { input: 'where is my order', expect: 'ORDER_STATUS' },
  { input: "where's my order", expect: 'ORDER_STATUS' },
  { input: 'track my order', expect: 'ORDER_STATUS' },
  { input: 'can I cancel my order', expect: 'CANCEL_ORDER' },
  { input: 'I want to cancel', expect: 'CANCEL_ORDER' },
  { input: '__REQUEST_CANCEL__', expect: 'REQUEST_CANCEL' },
  { input: '__CONFIRM_CANCEL__', expect: 'CONFIRM_CANCEL' },
  { input: 'yes, cancel my order', expect: 'CONFIRM_CANCEL' },
  { input: '__KEEP_ORDER__', expect: 'KEEP_ORDER' },
  { input: '__CANCEL_WHY__', expect: 'CANCEL_WHY' },
  { input: 'Refund status', expect: 'REFUND_STATUS' },
  { input: 'Payment issue', expect: 'PAYMENT_MENU' },
  { input: 'payment failed', expect: 'PAYMENT' },
  { input: 'Money was deducted', expect: 'PAYMENT' },
  { input: 'Delivery issue', expect: 'DELIVERY_MENU' },
  { input: 'Order is late', expect: 'ORDER_STATUS' },
  { input: 'Product issue', expect: 'PRODUCT_MENU' },
  { input: 'missing item', expect: 'PRODUCT_ISSUE' },
  { input: 'Something else', expect: 'FREE_TEXT' },
  { input: '__FREE_TEXT__', expect: 'FREE_TEXT' },
  { input: 'Back to Help Options', expect: 'MAIN_MENU' },
  { input: '__MAIN_MENU__', expect: 'MAIN_MENU' },
  { input: 'contact support', expect: 'CONTACT_SUPPORT' },
  { input: 'End chat', expect: 'END_CHAT' },
  { input: '__END_CHAT__', expect: 'END_CHAT' },
];

let failed = 0;
for (const c of cases) {
  const got = detectQcAssistantIntent(c.input);
  const ok = got === c.expect;
  if (!ok) {
    failed += 1;
    console.error(`FAIL: "${c.input}" → ${got} (expected ${c.expect})`);
  } else {
    console.log(`ok: "${c.input}" → ${got}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} intent test(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} intent tests passed`);
