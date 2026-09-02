import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../utils/jwt';
import { error } from '../utils/response';
import { UserRole } from '../types';
import { env } from '../config/env';
import Seller from '../models/Seller';

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    error(res, 'Authentication required', 401);
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    error(res, 'Invalid or expired token', 401);
  }
}

function extractCustomerIdFromProfilePayload(payload: unknown): string | null {
  const root = payload as {
    data?: Record<string, unknown>;
    uid?: string;
    userId?: string;
    _id?: string;
  };
  const profile = (root.data ?? root) as Record<string, unknown>;
  const userId = profile.uid || profile.userId || profile._id;
  if (!userId) return null;
  return String(userId);
}

async function resolveCustomerViaApiGateway(token: string): Promise<TokenPayload | null> {
  const baseUrl = env.API_GATEWAY_URL?.trim();
  if (!baseUrl) return null;

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/profiles/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const payload = await response.json();
  const userId = extractCustomerIdFromProfilePayload(payload);
  if (!userId) return null;

  return {
    sub: userId,
    role: 'CUSTOMER',
    tokenType: 'platform',
  };
}

async function resolveCustomerViaUserService(token: string): Promise<TokenPayload | null> {
  const baseUrl = env.USER_SERVICE_URL?.trim();
  const serviceAuth = env.SERVICE_AUTH_TOKEN?.trim();
  if (!baseUrl || !serviceAuth) return null;

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/profiles/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Service-Auth': serviceAuth,
    },
  });

  if (!response.ok) return null;

  const payload = await response.json();
  const userId = extractCustomerIdFromProfilePayload(payload);
  if (!userId) return null;

  return {
    sub: userId,
    role: 'CUSTOMER',
    tokenType: 'platform',
  };
}

/** Customer routes — accepts QC/platform JWT or Firebase token validated via API gateway. */
export async function authenticateCustomer(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    error(res, 'Authentication required', 401);
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
    return;
  } catch {
    // Fall through to user-service validation for Firebase/mobile tokens.
  }

  try {
    const customer =
      (await resolveCustomerViaApiGateway(token)) ||
      (await resolveCustomerViaUserService(token));
    if (customer) {
      req.user = customer;
      next();
      return;
    }
  } catch {
    // Fall through to unauthorized response.
  }

  error(res, 'Invalid or expired token', 401);
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      error(res, 'Insufficient permissions', 403);
      return;
    }
    next();
  };
}

/** Attach sellerId for platform-authenticated sellers */
export async function attachSeller(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    error(res, 'Authentication required', 401);
    return;
  }

  const userId = req.user.sub;
  const seller = await Seller.findOne({ userId });
  if (!seller) {
    error(res, 'Seller account not found. Please register first.', 404);
    return;
  }

  req.user.sellerId = seller._id.toString();
  next();
}

export const requireAdmin = [authenticate, requireRole('ADMIN')];

export const requireSeller = [
  authenticate,
  requireRole('SELLER'),
  attachSeller,
];

export const requireAdminOrSeller = [authenticate, requireRole('ADMIN', 'SELLER')];
