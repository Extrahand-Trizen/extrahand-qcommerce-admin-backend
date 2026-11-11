import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken, TokenPayload } from '../utils/jwt';
import { error } from '../utils/response';
import { UserRole } from '../types';
import logger from '../config/logger';
import { fetchVerifiedProfile } from '../utils/userProfile';
import { resolveSellerByUidOrPhone } from '../services/SellerIdentityService';
import { SellerService } from '../services/SellerService';
import SellerStaff from '../models/SellerStaff';
import SellerRole from '../models/SellerRole';

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (req.query?.token && typeof req.query.token === 'string') return req.query.token;
  return null;
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

  // Fast path 0 — if token payload already contains a valid sellerId, verify staff status/session
  if (req.user.sellerId) {
    if (req.user.staffId) {
      try {
        const staffDoc = await SellerStaff.findById(req.user.staffId).lean();
        if (!staffDoc || staffDoc.status === 'REMOVED') {
          error(res, 'Staff account has been removed. Access revoked.', 401);
          return;
        }
        if (staffDoc.status === 'INACTIVE' || staffDoc.status === 'SUSPENDED') {
          error(res, 'Staff account is currently inactive or suspended. Please contact store owner.', 403);
          return;
        }
        // Remote session invalidation check
        if (
          req.user.sessionVersion !== undefined &&
          req.user.sessionVersion < (staffDoc.sessionVersion || 1)
        ) {
          error(res, 'Your session has been terminated by the store owner. Please log in again.', 401);
          return;
        }

        // Dynamically reload up-to-date permissions from assigned role
        let livePermissions = staffDoc.permissions || [];
        let liveRole = staffDoc.role || 'Staff';
        if (staffDoc.roleId) {
          const roleDoc = await SellerRole.findById(staffDoc.roleId).lean();
          if (roleDoc) {
            livePermissions = roleDoc.permissions;
            liveRole = roleDoc.name;
          }
        }

        req.user.permissions = livePermissions;
        req.user.sellerRole = liveRole;
        req.user.staffName = staffDoc.name;
      } catch (err) {
        logger.error('Failed to verify staff session state in auth middleware', { error: err });
      }
    } else {
      if (!req.user.sellerRole) {
        req.user.sellerRole = 'OWNER';
      }
      req.user.permissions = ['*'];
    }
    next();
    return;
  }

  const userId = req.user.sub;
  let verifiedPhone = req.user.phone;

  // Extract client device info and IP
  const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip;
  const deviceInfo = {
    deviceId: (req.headers['x-device-id'] as string) || undefined,
    deviceName: (req.headers['x-device-name'] as string) || undefined,
    os: (req.headers['x-device-os'] as string) || undefined,
    appVersion: (req.headers['x-app-version'] as string) || undefined,
  };

  // 1. Fast path first with known UID / phone.
  let resolution = await resolveSellerByUidOrPhone({ userId, verifiedPhone, ipAddress, deviceInfo });

  // 2. If missed and phone wasn't yet known, fetch profile to get verified phone.
  if (!resolution.ok && !verifiedPhone) {
    const token = bearer(req);
    if (token) {
      try {
        const profile = await fetchVerifiedProfile(token);
        if (profile?.phone) {
          verifiedPhone = profile.phone;
          req.user.phone = verifiedPhone;
          resolution = await resolveSellerByUidOrPhone({ userId, verifiedPhone, ipAddress, deviceInfo });
        }
      } catch {
        // profile fetch failed
      }
    }
  }

  if (resolution.ok) {
    req.user.sellerId = resolution.seller._id.toString();
    req.user.sellerRole = resolution.staffRole || 'OWNER';
    req.user.sessionVersion = resolution.sessionVersion;
    if (resolution.staffMember) {
      req.user.staffId = resolution.staffMember._id.toString();
      req.user.staffName = resolution.staffMember.name;
      req.user.permissions = resolution.permissions || resolution.staffMember.permissions || [];
    } else {
      req.user.permissions = ['*'];
    }
    next();
    return;
  }

  if (
    resolution.reason === 'INACTIVE' ||
    resolution.reason === 'SUSPENDED' ||
    resolution.reason === 'REMOVED' ||
    resolution.reason === 'EXPIRED' ||
    resolution.reason === 'TEMPORARY_EXPIRED'
  ) {
    error(res, resolution.message || 'Staff account access denied', 403);
    return;
  }

  // Not found - user does not have an active seller account
  error(res, 'Seller account not found. Please register first.', 404);
}

/** Seller routes — accepts QC/platform JWT or Firebase token validated via user-service. */
export async function authenticateSeller(
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
      req.user = { sub: profile.uid, role: 'SELLER', tokenType: 'platform', phone: profile.phone };
      next();
      return;
    }
  } catch {
    // Fall through to unauthorized response.
  }

  error(res, 'Invalid or expired token', 401);
}

export const requireAdmin = [authenticate, requireRole('SUPER_ADMIN', 'CATALOGUE_ADMIN', 'SELLER_OPERATIONS_ADMIN')];

export const requireSeller = [
  authenticateSeller,
  requireRole('SELLER', 'CUSTOMER'),
  attachSeller,
];

export const requireAdminOrSeller = [authenticateSeller, requireRole('SUPER_ADMIN', 'CATALOGUE_ADMIN', 'SELLER_OPERATIONS_ADMIN', 'SELLER')];

/** Only SUPER_ADMIN and SELLER_OPERATIONS_ADMIN can manage sellers */
export const requireSellerAdmin = [authenticate, requireRole('SUPER_ADMIN', 'SELLER_OPERATIONS_ADMIN')];

/** Only SUPER_ADMIN and CATALOGUE_ADMIN can manage catalogue */
export const requireCatalogueAdmin = [authenticate, requireRole('SUPER_ADMIN', 'CATALOGUE_ADMIN')];

/** Only SUPER_ADMIN */
export const requireSuperAdmin = [authenticate, requireRole('SUPER_ADMIN')];

/** SUPER_ADMIN or CATALOGUE_ADMIN (alias used by some route files) */
export const requireCatalogueOrSuperAdmin = requireCatalogueAdmin;

/** Restricts route to shop owners only (blocks staff/helpers) */
export function requireSellerOwner(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    error(res, 'Authentication required', 401);
    return;
  }
  if (req.user.sellerRole && req.user.sellerRole !== 'OWNER') {
    error(res, 'Access denied. Only the shop owner can perform this action.', 403);
    return;
  }
  next();
}

export const requireOwner = [
  ...requireSeller,
  requireSellerOwner,
];

/**
 * Require a specific module permission or permissions.
 * Store Owners always bypass permission checks ('*' access).
 * Staff members must possess at least one of the specified permissions.
 */
export function requirePermission(...permissions: string[]) {
  return [
    ...requireSeller,
    (req: AuthRequest, res: Response, next: NextFunction): void => {
      if (!req.user) {
        error(res, 'Authentication required', 401);
        return;
      }

      if (req.user.sellerRole === 'OWNER') {
        next();
        return;
      }

      const userPerms = req.user.permissions || [];
      if (userPerms.includes('*')) {
        next();
        return;
      }

      const hasAny = permissions.some((p) => userPerms.includes(p));
      if (!hasAny) {
        error(
          res,
          `Access denied: You do not have permission (${permissions.join(' or ')}) to perform this action.`,
          403,
        );
        return;
      }

      next();
    },
  ];
}
