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

async function resolveCustomerFromUserService(token: string): Promise<TokenPayload | null> {
  const baseUrl = env.USER_SERVICE_URL?.trim();
  if (!baseUrl) return null;

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/profiles/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    data?: { userId?: string; _id?: string };
    userId?: string;
  };
  const userId = payload.data?.userId || payload.userId || payload.data?._id;
  if (!userId) return null;

  return {
    sub: String(userId),
    role: 'CUSTOMER',
    tokenType: 'platform',
  };
}

/** Customer routes — accepts QC/platform JWT or Firebase token validated via user-service. */
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
    const customer = await resolveCustomerFromUserService(token);
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
