import { env } from '../config/env';
import logger from '../config/logger';

/**
 * Thin client for the platform user-service. Used to link a Seller record back
 * to its user Profile after a Seller App registration:
 *   Profile.sellerProfile = { sellerId }
 * (the `'seller'` role itself is added by the user-service via the
 * `authChannel: 'seller_app'` path during OTP completion.)
 *
 * Best-effort: a user-service outage must not break seller registration.
 */

interface SellerLinkPatch {
  sellerId?: string;
}

export type UserProfileSummary = {
  _id: string;
  uid?: string;
  name?: string;
  phone?: string;
  photoURL?: string | null;
  rating?: number;
  totalReviews?: number;
  isVerified?: boolean;
  isAadhaarVerified?: boolean;
  location?: {
    type?: string;
    coordinates?: number[];
  };
};

function userServiceAuthToken(): string {
  return (
    env.USER_SERVICE_AUTH_TOKEN?.trim() ||
    env.SERVICE_AUTH_TOKEN?.trim() ||
    ''
  );
}

export async function getUserProfilesByIds(
  profileIds: string[],
): Promise<Map<string, UserProfileSummary>> {
  const ids = [...new Set(profileIds.map((id) => String(id).trim()).filter(Boolean))];
  const baseUrl = env.USER_SERVICE_URL?.trim();
  const serviceAuth = userServiceAuthToken();
  if (!ids.length || !baseUrl || !serviceAuth) return new Map();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/profiles/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'qcommerce-seller-service',
      },
      body: JSON.stringify({ profileIds: ids }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn('getUserProfilesByIds: user-service returned non-2xx', {
        status: res.status,
      });
      return new Map();
    }

    const payload = (await res.json()) as { profiles?: UserProfileSummary[] };
    return new Map(
      (payload.profiles || []).map((profile) => [String(profile._id), profile]),
    );
  } catch (err: any) {
    logger.warn('getUserProfilesByIds failed (non-fatal)', { error: err?.message });
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

export async function linkSellerToUser(userId: string, patch: SellerLinkPatch): Promise<boolean> {
  const baseUrl = env.USER_SERVICE_URL?.trim();
  const serviceAuth = userServiceAuthToken();

  if (!baseUrl || !serviceAuth) {
    logger.warn('linkSellerToUser skipped — USER_SERVICE_URL / SERVICE_AUTH_TOKEN not configured', { userId });
    return false;
  }
  if (!userId) return false;

  const sellerProfile: SellerLinkPatch = {};
  if (patch.sellerId) sellerProfile.sellerId = String(patch.sellerId);
  if (Object.keys(sellerProfile).length === 0) return false;

  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/profiles/internal/${encodeURIComponent(userId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
        'X-Service-Name': 'qcommerce-seller-service',
      },
      body: JSON.stringify({ sellerProfile, roles: ['seller'] }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('linkSellerToUser: user-service returned non-2xx', {
        userId,
        status: res.status,
        body: text.slice(0, 300),
      });
      return false;
    }

    logger.info('linkSellerToUser: Profile linked', { userId, ...sellerProfile });
    return true;
  } catch (err: any) {
    logger.warn('linkSellerToUser failed (non-fatal)', { userId, error: err?.message });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
