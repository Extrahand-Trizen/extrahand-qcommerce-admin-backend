import Seller, { ISeller } from '../models/Seller';
import SellerStaff, { ISellerStaff } from '../models/SellerStaff';
import SellerRole from '../models/SellerRole';
import { StaffRole } from '../types';
import logger from '../config/logger';
import { phoneVariants, phoneLast10 } from '../utils/phone';

/**
 * Seller identity resolution that survives Firebase UID rotation.
 * Supports both Store Owners (`Seller`) and Store Staff / Helpers (`SellerStaff`).
 */

export type SellerResolution =
  | {
      ok: true;
      seller: ISeller;
      healed: boolean;
      staffRole?: StaffRole;
      staffMember?: ISellerStaff;
      permissions?: string[];
      sessionVersion?: number;
    }
  | {
      ok: false;
      reason: 'NOT_FOUND' | 'AMBIGUOUS' | 'INACTIVE' | 'SUSPENDED' | 'REMOVED' | 'EXPIRED' | 'TEMPORARY_EXPIRED';
      message?: string;
    };

/** Best-effort E11000 detector for the `userId` unique index. */
function isUserIdDuplicateError(err: unknown): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  return e?.code === 11000 && Boolean(e.keyPattern?.userId);
}

export async function resolveSellerByUidOrPhone(params: {
  userId: string;
  /** MUST come from the verified auth token / user-service profile — never req.body. */
  verifiedPhone?: string | null;
  ipAddress?: string;
  deviceInfo?: {
    deviceId?: string;
    deviceName?: string;
    os?: string;
    appVersion?: string;
  };
}): Promise<SellerResolution> {
  const { userId, verifiedPhone, ipAddress, deviceInfo } = params;

  // 1. Fast path for Store Owner — check Seller by UID.
  const byUid = await Seller.findOne({ userId });
  if (byUid && byUid.status !== 'DELETED') {
    return { ok: true, seller: byUid, healed: false, staffRole: 'OWNER' };
  }

  // 2. Compute phone variants if trusted phone is available.
  const variants = phoneVariants(verifiedPhone);

  // 3. Recover Owner by phone if phone is available.
  if (variants.length > 0) {
    const matches = await Seller.find({
      mobileNumber: { $in: variants },
      status: { $ne: 'DELETED' },
    }).limit(2);

    if (matches.length > 1) {
      logger.error('Seller identity: ambiguous phone match — not rebinding', {
        phoneLast10: phoneLast10(verifiedPhone),
        sellerIds: matches.map((m) => String(m._id)),
      });
      return { ok: false, reason: 'AMBIGUOUS' };
    }

    if (matches.length === 1) {
      const found = matches[0];
      const oldUserId = found.userId;

      if (oldUserId === userId) {
        return { ok: true, seller: found, healed: false, staffRole: 'OWNER' };
      }

      // Rebind Owner userId
      try {
        await Seller.updateOne(
          { _id: found._id, userId: { $ne: userId } },
          { $set: { userId, lastLoginAt: new Date() } },
        );
      } catch (err) {
        if (isUserIdDuplicateError(err)) {
          logger.error('Seller identity: new UID already bound elsewhere — not rebinding', {
            phoneLast10: phoneLast10(verifiedPhone),
            sellerId: String(found._id),
          });
          return { ok: false, reason: 'AMBIGUOUS' };
        }
        throw err;
      }

      found.userId = userId;
      logger.warn('Seller identity reconciliation: Firebase UID changed, seller recovered by phone', {
        sellerId: String(found._id),
        oldUserId,
        newUserId: userId,
      });

      return { ok: true, seller: found, healed: true, staffRole: 'OWNER' };
    }
  }

  // 4. If not a primary Store Owner, check if user is a registered Staff member.
  const staffQueryConditions: Record<string, any>[] = [{ userId }];
  if (variants.length > 0) {
    staffQueryConditions.push({ phone: { $in: variants } });
  }

  const staff = await SellerStaff.findOne({
    $or: staffQueryConditions,
  });

  if (staff) {
    if (staff.status === 'REMOVED') {
      logger.warn('Staff login blocked: account has been removed', {
        staffId: String(staff._id),
        phone: staff.phone,
      });
      return {
        ok: false,
        reason: 'REMOVED',
        message: 'Your staff account has been removed by the store owner.',
      };
    }

    if (staff.status === 'INACTIVE' || staff.status === 'SUSPENDED') {
      logger.warn('Staff login blocked: account is inactive or suspended', {
        staffId: String(staff._id),
        phone: staff.phone,
        status: staff.status,
      });
      return {
        ok: false,
        reason: staff.status === 'SUSPENDED' ? 'SUSPENDED' : 'INACTIVE',
        message:
          staff.status === 'SUSPENDED'
            ? 'Your staff account has been suspended. Please contact store management.'
            : 'Your staff account is currently inactive. Please contact your store owner.',
      };
    }

    // Check invitation expiry for pending staff
    if (staff.status === 'PENDING' && staff.invitationExpiresAt) {
      if (new Date(staff.invitationExpiresAt).getTime() < Date.now()) {
        logger.warn('Staff login blocked: invitation expired', {
          staffId: String(staff._id),
          phone: staff.phone,
          expiredAt: staff.invitationExpiresAt,
        });
        return {
          ok: false,
          reason: 'EXPIRED',
          message: 'Your staff invitation has expired. Please ask the shop owner to resend the invite.',
        };
      }
    }

    // Check temporary staff validity
    if (staff.temporaryUntil && new Date(staff.temporaryUntil).getTime() < Date.now()) {
      logger.warn('Staff login blocked: temporary access expired', {
        staffId: String(staff._id),
        temporaryUntil: staff.temporaryUntil,
      });
      return {
        ok: false,
        reason: 'TEMPORARY_EXPIRED',
        message: 'Your temporary staff access period has expired.',
      };
    }

    const store = await Seller.findOne({ _id: staff.sellerId, status: { $ne: 'DELETED' } });
    if (store) {
      const now = new Date();
      const updates: Record<string, any> = { lastLoginAt: now };
      if (ipAddress) {
        updates.lastLoginIp = ipAddress;
      }

      // Activation flow: If PENDING, transition to ACTIVE upon first successful Firebase phone OTP
      if (staff.status === 'PENDING') {
        updates.status = 'ACTIVE';
        updates.acceptedAt = now;
        updates.activatedAt = now;
        staff.status = 'ACTIVE';
      }

      if (staff.userId !== userId) {
        updates.userId = userId;
        staff.userId = userId;
      }

      // Device tracking
      if (deviceInfo?.deviceId) {
        const existingDeviceIdx = staff.devices?.findIndex(
          (d) => d.deviceId === deviceInfo.deviceId
        );
        if (existingDeviceIdx !== undefined && existingDeviceIdx >= 0) {
          staff.devices[existingDeviceIdx].lastActiveAt = now;
          if (ipAddress) staff.devices[existingDeviceIdx].ipAddress = ipAddress;
          if (deviceInfo.deviceName) staff.devices[existingDeviceIdx].deviceName = deviceInfo.deviceName;
          if (deviceInfo.appVersion) staff.devices[existingDeviceIdx].appVersion = deviceInfo.appVersion;
          updates.devices = staff.devices;
        } else {
          updates.$push = {
            devices: {
              deviceId: deviceInfo.deviceId,
              deviceName: deviceInfo.deviceName || '',
              os: deviceInfo.os || '',
              appVersion: deviceInfo.appVersion || '',
              lastActiveAt: now,
              ipAddress: ipAddress || '',
            },
          };
        }
      }

      await SellerStaff.updateOne({ _id: staff._id }, updates);

      // Retrieve dynamic permissions from assigned custom role if roleId exists
      let effectivePermissions = staff.permissions || [];
      let effectiveRole = staff.role || 'Staff';

      if (staff.roleId) {
        const roleDoc = await SellerRole.findById(staff.roleId);
        if (roleDoc) {
          effectivePermissions = roleDoc.permissions;
          effectiveRole = roleDoc.name;
        }
      }

      return {
        ok: true,
        seller: store,
        healed: false,
        staffRole: effectiveRole,
        staffMember: staff,
        permissions: effectivePermissions,
        sessionVersion: staff.sessionVersion || 1,
      };
    }
  }

  return { ok: false, reason: 'NOT_FOUND' };
}
