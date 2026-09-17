import { env } from './env';

/**
 * Central configuration for ExtraHand Seller Settlements, Earnings & Payouts.
 * Modify SELLER_SETTLEMENT_HOURS to 24 or 48 as business requirements dictate.
 */
export const SELLER_SETTLEMENT_CONFIG = {
  /** Configurable settlement window in hours (default: 48 hours). Supports 24 or 48. */
  SETTLEMENT_HOURS: Number(process.env.SELLER_SETTLEMENT_HOURS || 48),

  /** ExtraHand platform commission percentage on gross product item total (e.g., 5%). */
  PLATFORM_COMMISSION_PERCENT: Number(process.env.EXTRAHAND_COMMISSION_PERCENT || 5),

  /** GST percentage applicable to the platform commission (18%). */
  COMMISSION_GST_PERCENT: Number(process.env.COMMISSION_GST_PERCENT || 18),

  /** Minimum payout withdrawal threshold in paise (₹500 = 50,000 paise). */
  MINIMUM_PAYOUT_AMOUNT_PAISE: 50_000,

  /** Scheduled interval (ms) for running the matured settlements sweeper (every 60s). */
  SETTLEMENT_SWEEP_INTERVAL_MS: 60_000,
} as const;

/** Helper to calculate seller net earnings from item total. */
export function calculateSellerOrderEarnings(itemTotalPaise: number) {
  const grossPaise = Math.max(0, Math.round(itemTotalPaise));
  const commissionPaise = Math.round(
    (grossPaise * SELLER_SETTLEMENT_CONFIG.PLATFORM_COMMISSION_PERCENT) / 100,
  );
  const gstPaise = Math.round(
    (commissionPaise * SELLER_SETTLEMENT_CONFIG.COMMISSION_GST_PERCENT) / 100,
  );
  const netEarningsPaise = Math.max(0, grossPaise - commissionPaise - gstPaise);

  return {
    grossPaise,
    commissionPaise,
    gstPaise,
    netEarningsPaise,
  };
}
