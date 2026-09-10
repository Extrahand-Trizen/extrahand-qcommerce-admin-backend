import { env } from '../config/env';
import logger from '../config/logger';

/**
 * The trusted view of the authenticated user, fetched from user-service
 * `/api/v1/profiles/me`. The bearer token has already been verified there
 * (Firebase ID token or platform JWT), so `uid` / `phone` here are trustworthy —
 * unlike anything in the request body.
 */
export interface VerifiedProfile {
  uid?: string;
  phone?: string;
  roles?: string[];
}

function pick(payload: unknown): VerifiedProfile | null {
  const root = payload as Record<string, unknown>;
  const p = ((root?.data as Record<string, unknown>) ?? (root?.profile as Record<string, unknown>) ?? root) || {};
  const uid = p.uid || p.userId || p._id || p.id;
  const phone = p.phone || p.phoneNumber || p.mobile || p.mobileNumber;
  const rawRoles = p.roles;
  const roles = Array.isArray(rawRoles)
    ? rawRoles.map((r) => String(r || '').trim().toLowerCase()).filter(Boolean)
    : undefined;
  if (!uid && !phone) return null;
  return {
    uid: uid ? String(uid) : undefined,
    phone: phone ? String(phone) : undefined,
    roles,
  };
}

async function get(url: string, headers: Record<string, string>): Promise<VerifiedProfile | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return pick(await res.json());
  } catch (err) {
    logger.warn('fetchVerifiedProfile: request failed', { url, error: (err as Error)?.message });
    return null;
  }
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; profile: VerifiedProfile }>();

/**
 * Resolve the authenticated user's profile (uid, verified phone, roles) via the
 * API gateway, falling back to a direct service call. 60s in-memory cache keyed
 * by the bearer token so a burst of requests doesn't hammer user-service.
 */
export async function fetchVerifiedProfile(token: string): Promise<VerifiedProfile | null> {
  if (!token) return null;
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.profile;

  let profile: VerifiedProfile | null = null;

  const gateway = env.API_GATEWAY_URL?.trim();
  if (gateway) {
    profile = await get(`${gateway.replace(/\/$/, '')}/api/v1/profiles/me`, {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
  }

  if (!profile) {
    const userSvc = env.USER_SERVICE_URL?.trim();
    const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();
    if (userSvc && serviceAuth) {
      profile = await get(`${userSvc.replace(/\/$/, '')}/api/v1/profiles/me`, {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Service-Auth': serviceAuth,
      });
    }
  }

  if (profile) cache.set(token, { at: Date.now(), profile });
  return profile;
}
