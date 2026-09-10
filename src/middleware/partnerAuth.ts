import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { verifyPlatformTokenRaw } from '../utils/jwt';
import { env } from '../config/env';
import logger from '../config/logger';

export interface PartnerRequest extends Request {
  partner?: { uid: string; name?: string; phone?: string };
}

interface ResolvedPartner {
  uid: string;
  name?: string;
  phone?: string;
  roles: string[];
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; partner: ResolvedPartner }>();

function tokenKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeRoles(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return list.map((r) => String(r || '').trim().toLowerCase()).filter(Boolean);
}

function extractProfile(payload: unknown): ResolvedPartner | null {
  const root = payload as Record<string, unknown>;
  const p = ((root?.data as Record<string, unknown>) ?? (root?.profile as Record<string, unknown>) ?? root) || {};
  const uid = p.uid || p.userId || p._id || p.id;
  if (!uid) return null;
  const phone =
    (p.phone as string) ||
    (p.phoneNumber as string) ||
    (p.mobile as string) ||
    (p.mobileNumber as string) ||
    undefined;
  return {
    uid: String(uid),
    name: (p.name as string) || (p.fullName as string) || undefined,
    phone: phone ? String(phone) : undefined,
    roles: normalizeRoles(p.roles),
  };
}

async function resolvePartnerViaGateway(token: string): Promise<ResolvedPartner | null> {
  const baseUrl = env.API_GATEWAY_URL?.trim();
  if (!baseUrl) return null;
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/profiles/me`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  return extractProfile(await res.json());
}

async function resolvePartnerViaUserService(token: string): Promise<ResolvedPartner | null> {
  const baseUrl = env.USER_SERVICE_URL?.trim();
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();
  if (!baseUrl || !serviceAuth) return null;
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/profiles/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Service-Auth': serviceAuth,
    },
  });
  if (!res.ok) return null;
  return extractProfile(await res.json());
}

function unauthorized(res: Response, message: string, code: string, status = 401): void {
  res.status(status).json({ success: false, error: message, code });
}

/**
 * Delivery-partner routes. Accepts a platform user-service JWT or (from the
 * mobile app) a Firebase ID token validated via the API gateway. The caller
 * must carry the `partner` role or the request is rejected 403 PICKUP_NOT_AUTHORIZED.
 */
export async function authenticatePartner(
  req: PartnerRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    unauthorized(res, 'Authentication required', 'AUTH_REQUIRED');
    return;
  }

  const key = tokenKey(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return finish(req, res, next, hit.partner);
  }

  let partner: ResolvedPartner | null = null;

  const platform = verifyPlatformTokenRaw(token);
  if (platform?.sub) {
    // A platform JWT proves identity but not the partner role — confirm via profile.
    try {
      partner =
        (await resolvePartnerViaGateway(token)) ||
        (await resolvePartnerViaUserService(token));
    } catch {
      /* fall through */
    }
    if (!partner) partner = { uid: platform.sub, roles: [] };
  } else {
    try {
      partner =
        (await resolvePartnerViaGateway(token)) ||
        (await resolvePartnerViaUserService(token));
    } catch (err) {
      logger.warn('authenticatePartner: profile resolution failed', {
        error: (err as Error)?.message,
      });
    }
  }

  if (!partner) {
    unauthorized(res, 'Invalid or expired token', 'AUTH_REQUIRED');
    return;
  }

  cache.set(key, { at: Date.now(), partner });
  return finish(req, res, next, partner);
}

function finish(
  req: PartnerRequest,
  res: Response,
  next: NextFunction,
  partner: ResolvedPartner,
): void {
  if (!partner.roles.includes('partner')) {
    unauthorized(
      res,
      "You're not signed in as a delivery partner",
      'PICKUP_NOT_AUTHORIZED',
      403,
    );
    return;
  }
  req.partner = { uid: partner.uid, name: partner.name, phone: partner.phone };
  next();
}

export const requirePartner = [authenticatePartner];
