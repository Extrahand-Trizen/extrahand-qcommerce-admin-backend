import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../utils/jwt';
import { error } from '../utils/response';
import { UserRole } from '../types';
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
