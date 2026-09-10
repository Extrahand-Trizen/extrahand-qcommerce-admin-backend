/**
 * ONE phone-number helper for identity matching. The Seller collection stores
 * bare 10-digit numbers; user-service stores E.164 (`+91XXXXXXXXXX`). We match on
 * the last 10 digits so both formats resolve to the same seller.
 *
 * This does NOT change how numbers are stored — it only builds lookup keys.
 */

/** Last 10 digits of any phone string, or '' if fewer than 10 digits. */
export function phoneLast10(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * Every stored representation the same number could have, for a `{ $in: [...] }`
 * match against `Seller.mobileNumber`. Empty array when the input has no valid
 * 10-digit tail (caller must treat that as "no match").
 */
export function phoneVariants(raw: string | null | undefined): string[] {
  const last10 = phoneLast10(raw);
  if (!last10) return [];
  return [...new Set([last10, `+91${last10}`, `91${last10}`, `+91 ${last10}`])];
}
