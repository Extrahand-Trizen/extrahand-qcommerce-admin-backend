import { env } from './env';
import { calculateOrderProductEarnings } from './platformFees';

/**
 * Central configuration for ExtraHand Seller Settlements, Earnings & Payouts.
 * Modify SELLER_SETTLEMENT_HOURS to 24 or 48 as business requirements dictate.
 */
export const SELLER_SETTLEMENT_CONFIG = {
  /** Configurable settlement window in minutes (default: 48 hours = 2880 minutes). */
  SETTLEMENT_MINUTES: Number(process.env.SELLER_SETTLEMENT_MINUTES || 48 * 60),

  /** Configurable settlement window in hours (default: 48 hours). */
  SETTLEMENT_HOURS: Number(process.env.SELLER_SETTLEMENT_HOURS || 48),

  /** ExtraHand default platform commission percentage on gross product item total (e.g., 5%). */
  PLATFORM_COMMISSION_PERCENT: Number(process.env.EXTRAHAND_COMMISSION_PERCENT || 5),

  /** GST percentage applicable to the platform commission (18%). */
  COMMISSION_GST_PERCENT: Number(process.env.COMMISSION_GST_PERCENT || 18),

  /** Minimum payout withdrawal threshold in paise (₹500 = 50,000 paise). */
  MINIMUM_PAYOUT_AMOUNT_PAISE: 50_000,

  /** Scheduled interval (ms) for running the matured settlements sweeper (every 60s). */
  SETTLEMENT_SWEEP_INTERVAL_MS: 60_000,

  /** Scheduled interval (ms) for running the automatic payout worker (default: 60s). */
  AUTO_PAYOUT_INTERVAL_MS: Number(process.env.AUTO_PAYOUT_INTERVAL_MS || 60_000),

  /** Feature flag: Enable/disable automatic seller payouts (default: true). */
  AUTO_PAYOUT_ENABLED: process.env.AUTO_PAYOUT_ENABLED !== 'false',
} as const;

/** Helper to calculate seller net earnings from item total and optional order items / category. */
export function calculateSellerOrderEarnings(
  orderOrItemTotal:
    | number
    | {
        itemTotalPaise?: number;
        amountPaise?: number;
        items?: any[];
        shopCategory?: string;
        categorySlug?: string;
      },
  items?: any[],
  shopCategory?: string,
) {
  if (typeof orderOrItemTotal === 'object' && orderOrItemTotal !== null) {
    const itemTotalPaise = orderOrItemTotal.itemTotalPaise || orderOrItemTotal.amountPaise || 0;
    const orderItems = orderOrItemTotal.items || items;
    const cat = orderOrItemTotal.shopCategory || orderOrItemTotal.categorySlug || shopCategory;
    return calculateOrderProductEarnings({ itemTotalPaise, items: orderItems, shopCategory: cat });
  }

  const itemTotalPaise = Number(orderOrItemTotal) || 0;
  return calculateOrderProductEarnings({ itemTotalPaise, items, shopCategory });
}
