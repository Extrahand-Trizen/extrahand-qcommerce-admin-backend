import Seller, { ISeller } from '../models/Seller';
import logger from '../config/logger';
import { phoneVariants, phoneLast10 } from '../utils/phone';

/**
 * Seller identity resolution that survives Firebase UID rotation.
 *
 * `Seller._id` is the permanent identity. `Seller.userId` holds the CURRENT
 * Firebase UID and is treated as an auth pointer, not an identity. When Firebase
 * issues a new UID for the same phone (e.g. the Auth user was deleted and the
 * number re-registered), the UID lookup misses — we then recover the existing
 * seller by verified phone and rebind `userId`, rather than treating them as new.
 *
 * Mirrors user-service's `reconcileProfileUidByPhone` pattern. Used by REST auth
 * (`attachSeller`), Socket.IO auth, and `registerSeller` so there is one
 * implementation.
 */

export type SellerResolution =
  | { ok: true; seller: ISeller; healed: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'AMBIGUOUS' };

/** Best-effort E11000 detector for the `userId` unique index. */
function isUserIdDuplicateError(err: unknown): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  return e?.code === 11000 && Boolean(e.keyPattern?.userId);
}

export async function resolveSellerByUidOrPhone(params: {
  userId: string;
  /** MUST come from the verified auth token / user-service profile — never req.body. */
  verifiedPhone?: string | null;
}): Promise<SellerResolution> {
  const { userId, verifiedPhone } = params;

  // 1. Fast path — unchanged behaviour.
  const byUid = await Seller.findOne({ userId });
  if (byUid && byUid.status !== 'DELETED') {
    return { ok: true, seller: byUid, healed: false };
  }

  // 2. No trusted phone → cannot recover. Genuinely-new seller path.
  const variants = phoneVariants(verifiedPhone);
  if (variants.length === 0) return { ok: false, reason: 'NOT_FOUND' };

  // 3. Recover by phone.
  const matches = await Seller.find({
    mobileNumber: { $in: variants },
    status: { $ne: 'DELETED' },
  }).limit(2);

  if (matches.length === 0) return { ok: false, reason: 'NOT_FOUND' };

  if (matches.length > 1) {
    logger.error('Seller identity: ambiguous phone match — not rebinding', {
      phoneLast10: phoneLast10(verifiedPhone),
      sellerIds: matches.map((m) => String(m._id)),
    });
    return { ok: false, reason: 'AMBIGUOUS' };
  }

  const found = matches[0];
  const oldUserId = found.userId;

  if (oldUserId === userId) {
    // status was DELETED on the UID row but this phone row is fine — just use it.
    return { ok: true, seller: found, healed: false };
  }

  // 4. Rebind. Idempotent + race-safe: `userId: { $ne }` means two concurrent
  //    requests with the same new UID both no-op after the first wins.
  try {
    await Seller.updateOne(
      { _id: found._id, userId: { $ne: userId } },
      { $set: { userId, lastLoginAt: new Date() } },
    );
  } catch (err) {
    if (isUserIdDuplicateError(err)) {
      // The new UID is somehow already on another seller row — don't corrupt anything.
      logger.error('Seller identity: new UID already bound elsewhere — not rebinding', {
        phoneLast10: phoneLast10(verifiedPhone),
        sellerId: String(found._id),
      });
      return { ok: false, reason: 'AMBIGUOUS' };
    }
    throw err;
  }

  found.userId = userId;
  logger.warn('Seller identity reconciliation: Firebase UID changed, seller recovered by phone', {
    sellerId: String(found._id),
    oldUserId,
    newUserId: userId,
  });

  return { ok: true, seller: found, healed: true };
}
