import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRole } from '../types';

export interface TokenPayload {
  sub: string;
  email?: string;
  name?: string;
  role: UserRole | 'SELLER' | 'CUSTOMER';
  sellerId?: string;
  tokenType: 'qc_admin' | 'platform';
  sessionId?: string;
  profileId?: string;
}

interface QcAdminClaims {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
}

interface PlatformClaims {
  sub: string;
  sid: string;
  pid?: string;
}

export function signAccessToken(payload: Omit<TokenPayload, 'tokenType'>): string {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, name: payload.name, role: payload.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions
  );
}

export function signRefreshToken(payload: { sub: string }): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN } as jwt.SignOptions);
}

/** Verify QC admin JWT (issued by this service) */
function verifyQcAdminToken(token: string): TokenPayload {
  const payload = jwt.verify(token, env.JWT_SECRET) as QcAdminClaims;
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    role: payload.role || 'CATALOGUE_ADMIN',
    tokenType: 'qc_admin',
  };
}

/** Verify platform user-service JWT (for sellers) */
function verifyPlatformToken(token: string): TokenPayload {
  if (!env.ACCESS_TOKEN_SECRET) {
    throw new Error('Platform token verification not configured');
  }
  try {
    const payload = jwt.verify(token, env.ACCESS_TOKEN_SECRET, {
      issuer: env.TOKEN_ISSUER,
      audience: env.TOKEN_AUDIENCE,
    }) as PlatformClaims;
    return {
      sub: payload.sub,
      role: 'SELLER',
      tokenType: 'platform',
      sessionId: payload.sid,
      profileId: payload.pid,
    };
  } catch (err) {
    if (env.NODE_ENV !== 'production') {
      const payload = jwt.verify(token, env.ACCESS_TOKEN_SECRET) as PlatformClaims;
      if (payload?.sub) {
        return {
          sub: payload.sub,
          role: 'SELLER',
          tokenType: 'platform',
          sessionId: payload.sid,
          profileId: payload.pid,
        };
      }
    }
    throw err;
  }
}

/**
 * Verify a platform user-service JWT WITHOUT asserting a role. `verifyPlatformToken`
 * always stamps `role: 'SELLER'`; partner auth needs the raw `sub` and lets the
 * caller decide the role (from the user-service profile). Returns null on any
 * failure so callers can fall back to a Firebase-token path.
 */
export function verifyPlatformTokenRaw(token: string): { sub: string; sid?: string; pid?: string } | null {
  if (!env.ACCESS_TOKEN_SECRET) return null;
  const read = (opts?: jwt.VerifyOptions): { sub: string; sid?: string; pid?: string } | null => {
    try {
      const payload = jwt.verify(token, env.ACCESS_TOKEN_SECRET as string, opts) as PlatformClaims;
      return payload?.sub ? { sub: payload.sub, sid: payload.sid, pid: payload.pid } : null;
    } catch {
      return null;
    }
  };
  return (
    read({ issuer: env.TOKEN_ISSUER, audience: env.TOKEN_AUDIENCE }) ||
    (env.NODE_ENV !== 'production' ? read() : null)
  );
}

/** Try QC admin token first, then platform user-service token */
export function verifyToken(token: string): TokenPayload {
  try {
    return verifyQcAdminToken(token);
  } catch {
    return verifyPlatformToken(token);
  }
}
