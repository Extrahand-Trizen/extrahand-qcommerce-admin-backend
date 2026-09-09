import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../utils/jwt';
import { error } from '../utils/response';
import { UserRole } from '../types';
import logger from '../config/logger';
import { fetchVerifiedProfile } from '../utils/userProfile';
import { resolveSellerByUidOrPhone } from '../services/SellerIdentityService';

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
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

/** Customer routes — accepts QC/platform JWT or Firebase token validated via user-service. */
export async function authenticateCustomer(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearer(req);
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
    const profile = await fetchVerifiedProfile(token);
    if (profile?.uid) {
      req.user = { sub: profile.uid, role: 'CUSTOMER', tokenType: 'platform' };
      next();
      return;
    }
  } catch {
    // Fall through to unauthorized response.
  }

  error(res, 'Invalid or expired token', 401);
}

export function requireRole(...roles: (UserRole | 'SELLER' | 'CUSTOMER')[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      error(res, 'Insufficient permissions', 403);
      return;
    }
    next();
  };
}

/**
 * Attach sellerId for platform-authenticated sellers.
 *
 * Firebase UID (`req.user.sub`) is the primary key. If it misses — which happens
 * when Firebase rotated the UID for this phone — we recover the existing seller
 * by the VERIFIED phone from user-service and rebind `Seller.userId`. Only a
 * genuine "no UID, no phone match" is treated as a new seller.
 */
export async function attachSeller(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    error(res, 'Authentication required', 401);
    return;
  }

  const userId = req.user.sub;

  // Fast path first — avoids the profile fetch for the common case.
  const resolution = await resolveSellerByUidOrPhone({ userId });
  if (resolution.ok) {
    req.user.sellerId = resolution.seller._id.toString();
    next();
    return;
  }

  // Miss — try to recover by verified phone.
  const token = bearer(req);
  const profile = token ? await fetchVerifiedProfile(token) : null;
  if (profile?.phone) {
    const healed = await resolveSellerByUidOrPhone({ userId, verifiedPhone: profile.phone });
    if (healed.ok) {
      req.user.sellerId = healed.seller._id.toString();
      next();
      return;
    }
    if (healed.reason === 'AMBIGUOUS') {
      logger.error('attachSeller: ambiguous seller for phone — refusing', { userId });
      error(res, 'Your account needs attention. Please contact support.', 409);
      return;
    }
  }

  error(res, 'Seller account not found. Please register first.', 404);
}

export const requireAdmin = [authenticate, requireRole('SUPER_ADMIN', 'CATALOGUE_ADMIN', 'SELLER_OPERATIONS_ADMIN')];

export const requireSeller = [
  authenticate,
  requireRole('SELLER'),
  attachSeller,
];

export const requireAdminOrSeller = [authenticate, requireRole('SUPER_ADMIN', 'CATALOGUE_ADMIN', 'SELLER_OPERATIONS_ADMIN', 'SELLER')];

/** Only SUPER_ADMIN and SELLER_OPERATIONS_ADMIN can manage sellers */
export const requireSellerAdmin = [authenticate, requireRole('SUPER_ADMIN', 'SELLER_OPERATIONS_ADMIN')];

/** Only SUPER_ADMIN and CATALOGUE_ADMIN can manage catalogue */
export const requireCatalogueAdmin = [authenticate, requireRole('SUPER_ADMIN', 'CATALOGUE_ADMIN')];

/** Only SUPER_ADMIN */
export const requireSuperAdmin = [authenticate, requireRole('SUPER_ADMIN')];

/** SUPER_ADMIN or CATALOGUE_ADMIN (alias used by some route files) */
export const requireCatalogueOrSuperAdmin = requireCatalogueAdmin;
