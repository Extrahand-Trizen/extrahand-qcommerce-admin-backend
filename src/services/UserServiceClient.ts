import { env } from '../config/env';
import logger from '../config/logger';
import Seller from '../models/Seller';

/**
 * Thin client for the platform user-service. Links a Seller record to its user
 * Profile: adds the `'seller'` role (MERGED by user-service — other roles like
 * tasker/partner are never touched) and sets `Profile.sellerProfile.sellerId`.
 *
 * Resolves the profile by `userId` (Firebase UID) or, if that misses because the
 * UID rotated, by the seller's phone. When the profile's current UID differs
 * from `Seller.userId`, `Seller.userId` is rebound so both sides converge.
 *
 * Best-effort for the live path — a user-service outage must not break seller
 * registration — but the result is returned so the backfill can report on it.
 */

export interface LinkSellerResult {
  ok: boolean;
  found: boolean;
  conflict?: boolean;
  profileUid?: string;
  matchedBy?: 'uid' | 'phone';
  sellerRoleAdded?: boolean;
  reboundSellerUserId?: string;
  /** true = the user-service call itself failed (unreachable / non-2xx / route missing). */
  transportError?: boolean;
}

export async function linkSellerToUser(params: {
  sellerId: string;
  userId: string;
  phone?: string | null;
  /** Report what WOULD change without writing (backfill dry run). */
  preview?: boolean;
}): Promise<LinkSellerResult> {
  const { sellerId, userId, phone, preview } = params;
  const baseUrl = env.USER_SERVICE_URL?.trim();
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();

  if (!baseUrl || !serviceAuth) {
    logger.warn('linkSellerToUser skipped — USER_SERVICE_URL / SERVICE_AUTH_TOKEN not configured', { sellerId });
    return { ok: false, found: false };
  }
  if (!sellerId || !userId) return { ok: false, found: false };

  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/profiles/internal/${encodeURIComponent(userId)}/link-seller${preview ? '?preview=true' : ''}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'qcommerce-seller-service',
      },
      body: JSON.stringify({ sellerId: String(sellerId), phone: phone ? String(phone) : undefined }),
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => ({}))) as {
      found?: boolean;
      profileUid?: string;
      matchedBy?: 'uid' | 'phone';
      sellerRoleAdded?: boolean;
      conflict?: boolean;
      existingSellerId?: string;
      error?: string;
    };

    if (!res.ok) {
      logger.warn('linkSellerToUser: user-service returned non-2xx', { sellerId, userId, status: res.status, error: body.error });
      return { ok: false, found: false, transportError: true };
    }

    if (body.conflict) {
      logger.error('linkSellerToUser: profile linked to a different seller', {
        sellerId, profileUid: body.profileUid, existingSellerId: body.existingSellerId,
      });
      return { ok: false, found: true, conflict: true, profileUid: body.profileUid, matchedBy: body.matchedBy };
    }

    if (!body.found) {
      logger.warn('linkSellerToUser: no profile found for seller (uid + phone both missed)', { sellerId, userId });
      return { ok: false, found: false };
    }

    const result: LinkSellerResult = {
      ok: true,
      found: true,
      profileUid: body.profileUid,
      matchedBy: body.matchedBy,
      sellerRoleAdded: body.sellerRoleAdded,
    };

    // Converge Seller.userId onto the profile's current UID (skipped in preview).
    if (body.profileUid && body.profileUid !== userId) {
      if (!preview) {
        await Seller.updateOne(
          { _id: sellerId, userId: { $ne: body.profileUid } },
          { $set: { userId: body.profileUid } },
        );
        logger.warn('linkSellerToUser: rebound Seller.userId to profile uid', {
          sellerId, from: userId, to: body.profileUid,
        });
      }
      result.reboundSellerUserId = body.profileUid;
    }

    logger.info('linkSellerToUser: Profile linked', {
      sellerId, profileUid: body.profileUid, matchedBy: body.matchedBy, roleAdded: body.sellerRoleAdded,
    });
    return result;
  } catch (err: any) {
    logger.warn('linkSellerToUser failed (non-fatal)', { sellerId, error: err?.message });
    return { ok: false, found: false, transportError: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reverse of {@link linkSellerToUser}: tell the user-service to drop the
 * `'seller'` role and clear `Profile.sellerProfile` for this user. If `seller`
 * was the user's only role the user-service falls through to a full account
 * deletion; otherwise it keeps the account and every other role untouched.
 *
 * NOT best-effort — the caller (store deletion) must know whether the user side
 * succeeded, so this throws on any failure.
 */
export async function unlinkSeller(userId: string, reason?: string): Promise<{
  deletionMode?: string;
  removedRole?: string;
  deletedAt?: string;
}> {
  const baseUrl = env.USER_SERVICE_URL?.trim();
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();

  if (!baseUrl || !serviceAuth) {
    throw new Error('USER_SERVICE_URL / SERVICE_AUTH_TOKEN not configured');
  }
  if (!userId) throw new Error('userId is required');

  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/profiles/internal/${encodeURIComponent(userId)}/unlink-seller`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'qcommerce-seller-service',
      },
      body: JSON.stringify(reason ? { reason } : {}),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      logger.error('unlinkSeller: user-service returned non-2xx', {
        userId,
        status: res.status,
        body: text.slice(0, 300),
      });
      throw new Error(`user-service unlink-seller failed (${res.status})`);
    }

    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
    logger.info('unlinkSeller: seller role removed', { userId, result: parsed?.result });
    return parsed?.result || {};
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('user-service unlink-seller timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export interface PartnerProfileLite {
  uid: string;
  name?: string;
  phone?: string;
}

/**
 * Internal, service-to-service read of a delivery partner's profile by Firebase
 * UID (`GET /api/v1/profiles/internal/:uid` on the user-service). Used to show
 * "who is delivering this order" on the seller's Handover screen — the order
 * only stores `partnerUid`, the name/phone live on the profile.
 *
 * Best-effort: returns null on any failure (unconfigured, timeout, 404, non-2xx)
 * so the caller falls back to the snapshot captured at QR-scan time.
 */
export async function fetchPartnerProfile(uid: string): Promise<PartnerProfileLite | null> {
  const baseUrl = env.USER_SERVICE_URL?.trim();
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();
  if (!baseUrl || !serviceAuth || !uid) return null;

  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/profiles/internal/${encodeURIComponent(uid)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      headers: {
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'qcommerce-seller-service',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { profile?: Record<string, unknown> };
    const p = body.profile ?? {};
    const name =
      (p.name as string) ||
      (p.fullName as string) ||
      [p.firstName, p.lastName].filter(Boolean).join(' ').trim() ||
      undefined;
    const phoneRaw =
      (p.phone as string) ||
      (p.phoneNumber as string) ||
      (p.mobile as string) ||
      (p.mobileNumber as string) ||
      undefined;
    if (!name && !phoneRaw) return null;
    return { uid, name: name || undefined, phone: phoneRaw ? String(phoneRaw) : undefined };
  } catch (err) {
    logger.warn('fetchPartnerProfile failed', { uid, error: (err as Error)?.message });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
