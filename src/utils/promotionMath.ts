import { PromotionType, PromotionAppliesTo } from '../types';

/** Minimal promotion shape the discount math needs. */
export interface DiscountPromotion {
  type: PromotionType;
  value: number;
  appliesTo: PromotionAppliesTo;
  productMasterIds: Array<{ toString(): string }>;
  maxDiscountPaise?: number;
}

export interface DiscountLine {
  masterProductId: string;
  name?: string;
  quantity: number;
  lineTotalPaise: number;
}

export interface AppliedDiscount {
  discountPaise: number;
  lines: Array<{
    masterProductId: string;
    name: string;
    quantity: number;
    discountPaise: number;
  }>;
}

/**
 * Discount on a single money amount, honouring the PERCENT cap and the amount
 * itself. For PERCENT the deal price is floored to a whole rupee, so customers
 * see ₹399 rather than ₹399.20 (and never pay more than the stated %).
 */
export function discountForAmount(
  promo: Pick<DiscountPromotion, 'type' | 'value' | 'maxDiscountPaise'>,
  amountPaise: number,
): number {
  if (amountPaise <= 0) return 0;

  if (promo.type !== 'PERCENT') {
    return Math.max(0, Math.min(promo.value, amountPaise));
  }

  const raw = Math.round((amountPaise * promo.value) / 100);
  const capped = promo.maxDiscountPaise ? Math.min(raw, promo.maxDiscountPaise) : raw;
  // Round the resulting deal price down to a whole rupee.
  const dealPaise = Math.floor((amountPaise - capped) / 100) * 100;
  let discount = amountPaise - Math.max(0, dealPaise);
  if (promo.maxDiscountPaise) discount = Math.min(discount, promo.maxDiscountPaise);
  return Math.max(0, Math.min(discount, amountPaise));
}

/** Which lines a PRODUCTS-scoped promotion touches (all lines for ORDER scope). */
export function eligibleLines<T extends { masterProductId: string }>(
  promo: Pick<DiscountPromotion, 'appliesTo' | 'productMasterIds'>,
  lines: T[],
): T[] {
  if (promo.appliesTo !== 'PRODUCTS') return lines;
  const ids = new Set(promo.productMasterIds.map((id) => id.toString()));
  return lines.filter((line) => ids.has(line.masterProductId));
}

/**
 * Total discount for a promotion across a set of order lines, with a per-line
 * breakdown (proportional to line value; the last eligible line absorbs the
 * rounding remainder). Used for CODE coupons and the ledger.
 */
export function computePromotionDiscount(
  promo: DiscountPromotion,
  lines: DiscountLine[],
): AppliedDiscount {
  const eligible = eligibleLines(promo, lines);
  const base = eligible.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  if (base <= 0) return { discountPaise: 0, lines: [] };

  const total = discountForAmount(promo, base);
  if (total <= 0) return { discountPaise: 0, lines: [] };

  const out: AppliedDiscount['lines'] = [];
  let allocated = 0;
  eligible.forEach((line, i) => {
    const isLast = i === eligible.length - 1;
    const share = isLast
      ? total - allocated
      : Math.round((total * line.lineTotalPaise) / base);
    allocated += share;
    out.push({
      masterProductId: line.masterProductId,
      name: line.name ?? '',
      quantity: line.quantity,
      discountPaise: Math.max(0, share),
    });
  });

  return { discountPaise: total, lines: out };
}
