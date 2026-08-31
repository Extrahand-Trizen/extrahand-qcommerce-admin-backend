import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRole } from '../types';

export interface TokenPayload {
  sub: string;
  email?: string;
  name?: string;
  role: UserRole;
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
    role: payload.role || 'ADMIN',
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

/** Try QC admin token first, then platform user-service token */
export function verifyToken(token: string): TokenPayload {
  try {
    return verifyQcAdminToken(token);
  } catch {
    return verifyPlatformToken(token);
  }
}
