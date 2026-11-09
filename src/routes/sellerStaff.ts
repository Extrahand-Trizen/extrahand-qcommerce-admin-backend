import { Router, Response, NextFunction } from 'express';
import { AuthRequest, requireOwner, requireSeller } from '../middleware/auth';
import { success, AppError } from '../utils/response';
import SellerStaff from '../models/SellerStaff';
import SellerRole from '../models/SellerRole';
import Seller from '../models/Seller';
import StaffApprovalRequest from '../models/StaffApprovalRequest';
import { StaffActivityService } from '../services/StaffActivityService';
import { phoneLast10 } from '../utils/phone';
import {
  SELLER_APP_MODULES,
  ALL_PERMISSION_IDS,
  DEFAULT_SYSTEM_ROLES,
} from '../constants/permissions';
import mongoose from 'mongoose';

const router = Router();

/** Seed default roles if store has no roles configured, or reconcile existing roles */
async function getOrSeedStoreRoles(sellerId: mongoose.Types.ObjectId) {
  const existingRoles = await SellerRole.find({ sellerId });
  if (existingRoles.length === 0) {
    const rolesToSeed = DEFAULT_SYSTEM_ROLES.map((r) => ({
      ...r,
      sellerId,
    }));
    await SellerRole.insertMany(rolesToSeed);
    return SellerRole.find({ sellerId }).lean();
  }

  // Auto-upgrade / reconcile existing stores with updated 3 default presets
  const helperPreset = DEFAULT_SYSTEM_ROLES.find((r) => r.name === 'Order Helper / Packer');
  const cashierPreset = DEFAULT_SYSTEM_ROLES.find((r) => r.name === 'Cashier');

  // 1. If old "Inventory Associate" exists, reassign staff to "Order Helper / Packer" and remove obsolete preset
  const invRole = existingRoles.find((r) => r.isSystem && r.name === 'Inventory Associate');
  const helperRole = existingRoles.find((r) => r.isSystem && r.name === 'Order Helper / Packer');

  if (invRole) {
    if (helperRole) {
      await SellerStaff.updateMany(
        { sellerId, roleId: invRole._id },
        { $set: { roleId: helperRole._id, role: helperRole.name } }
      );
    }
    await SellerRole.deleteOne({ _id: invRole._id });
  }

  // 2. If old "Cashier / Billing" exists, rename to "Cashier"
  const oldCashierRole = existingRoles.find((r) => r.isSystem && r.name === 'Cashier / Billing');
  if (oldCashierRole) {
    await SellerRole.updateOne(
      { _id: oldCashierRole._id },
      { $set: { name: 'Cashier', description: cashierPreset?.description } }
    );
    await SellerStaff.updateMany(
      { sellerId, roleId: oldCashierRole._id },
      { $set: { role: 'Cashier' } }
    );
  } else if (!existingRoles.some((r) => r.isSystem && r.name === 'Cashier') && cashierPreset) {
    await SellerRole.create({ ...cashierPreset, sellerId });
  }

  // 3. Update Order Helper / Packer system role with combined permissions if needed
  if (helperRole && helperPreset) {
    const missingPerms = helperPreset.permissions.filter((p) => !helperRole.permissions.includes(p));
    if (missingPerms.length > 0) {
      const mergedPerms = Array.from(new Set([...helperRole.permissions, ...helperPreset.permissions]));
      await SellerRole.updateOne(
        { _id: helperRole._id },
        {
          $set: {
            description: helperPreset.description,
            permissions: mergedPerms,
          },
        }
      );
    }
  }

  return SellerRole.find({ sellerId }).lean();
}

// ============================================================================
// LOGGED-IN STAFF / PROFILE
// ============================================================================

/**
 * GET /api/v1/seller/staff/me
 * Returns current authenticated seller or staff member's role and permissions.
 */
router.get('/staff/me', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.user!.sellerId!;
    const sellerRole = req.user!.sellerRole || 'OWNER';
    const isOwner = sellerRole === 'OWNER';

    let staffDetails = null;
    let permissions = req.user!.permissions || (isOwner ? ['*'] : []);

    if (req.user!.staffId) {
      const staffDoc = await SellerStaff.findById(req.user!.staffId).lean();
      if (staffDoc) {
        staffDetails = staffDoc;
        // Dynamically resolve up-to-date permissions from assigned role if roleId exists
        if (staffDoc.roleId) {
          const roleDoc = await SellerRole.findById(staffDoc.roleId).lean();
          if (roleDoc) {
            permissions = roleDoc.permissions;
          }
        }
      }
    }

    return success(res, {
      sellerId,
      role: sellerRole,
      isOwner,
      staffName: req.user!.staffName || (isOwner ? 'Shop Owner' : 'Staff Member'),
      permissions,
      staffDetails,
    });
  } catch (e) {
    next(e);
  }
});

// ============================================================================
// PERMISSION DEFINITION METADATA
// ============================================================================

/**
 * GET /api/v1/seller/roles/permissions-list
 * Returns canonical dictionary of modules and operations available in Seller App.
 */
router.get('/roles/permissions-list', ...requireSeller, (_req: AuthRequest, res: Response) => {
  return success(res, {
    modules: SELLER_APP_MODULES,
    allPermissions: ALL_PERMISSION_IDS,
  });
});

// ============================================================================
// ROLES MANAGEMENT (OWNER ONLY)
// ============================================================================

/**
 * GET /api/v1/seller/roles
 * Lists all roles for the current store, with assigned staff counts.
 */
router.get('/roles', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const roles = await getOrSeedStoreRoles(sellerId);

    // Aggregate staff count per role (excluding REMOVED staff)
    const staffCounts = await SellerStaff.aggregate([
      { $match: { sellerId, status: { $ne: 'REMOVED' } } },
      { $group: { _id: '$roleId', count: { $sum: 1 } } },
    ]);
    const countMap: Record<string, number> = {};
    staffCounts.forEach((sc) => {
      if (sc._id) countMap[sc._id.toString()] = sc.count;
    });

    const enrichedRoles = roles.map((r) => ({
      ...r,
      staffCount: countMap[r._id.toString()] || 0,
    }));

    // Canonical sorting: System roles (Store Manager, Order Helper / Packer, Cashier), then Custom Roles
    const systemOrder = ['Store Manager', 'Order Helper / Packer', 'Cashier'];
    enrichedRoles.sort((a, b) => {
      if (a.isSystem && b.isSystem) {
        const idxA = systemOrder.indexOf(a.name);
        const idxB = systemOrder.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.name.localeCompare(b.name);
      }
      if (a.isSystem) return -1;
      if (b.isSystem) return 1;
      return a.name.localeCompare(b.name);
    });

    return success(res, enrichedRoles);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/seller/roles
 * Creates a custom role with selected permissions for the current store.
 */
router.post('/roles', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { name, description, permissions } = req.body as {
      name?: string;
      description?: string;
      permissions?: string[];
    };

    if (!name?.trim()) {
      return next(new AppError('Role name is required', 400));
    }

    const trimmedName = name.trim();
    if (!Array.isArray(permissions) || permissions.length === 0) {
      return next(new AppError('Please select at least one permission for this role', 400));
    }

    // Validate that all permissions exist in canonical list
    const invalidPerms = permissions.filter((p) => !ALL_PERMISSION_IDS.includes(p));
    if (invalidPerms.length > 0) {
      return next(new AppError(`Invalid permissions detected: ${invalidPerms.join(', ')}`, 400));
    }

    // Check duplicate role name for this store
    const existing = await SellerRole.findOne({ sellerId, name: trimmedName });
    if (existing) {
      return next(new AppError('A role with this name already exists in your store', 400));
    }

    const newRole = await SellerRole.create({
      sellerId,
      name: trimmedName,
      description: description?.trim() || '',
      isSystem: false,
      permissions,
    });

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'ROLE_CREATE',
      entityType: 'SellerRole',
      entityId: newRole._id.toString(),
      entityIdentifier: newRole.name,
      updatedValue: { name: newRole.name, permissionsCount: newRole.permissions.length },
    });

    return success(res, newRole, 201);
  } catch (e) {
    next(e);
  }
});

/**
 * PUT /api/v1/seller/roles/:id
 * Updates role name, description, or assigned permissions.
 * Immediately syncs permissions and triggers session updates for assigned staff.
 */
router.put('/roles/:id', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { id } = req.params;
    const { name, description, permissions } = req.body as {
      name?: string;
      description?: string;
      permissions?: string[];
    };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError('Invalid role ID', 400));
    }

    const role = await SellerRole.findOne({ _id: new mongoose.Types.ObjectId(id), sellerId });
    if (!role) {
      return next(new AppError('Role not found for this store', 404));
    }

    const oldName = role.name;
    const oldPermissions = [...role.permissions];

    if (name?.trim()) {
      const trimmedName = name.trim();
      if (trimmedName !== role.name) {
        const dup = await SellerRole.findOne({
          sellerId,
          name: trimmedName,
          _id: { $ne: role._id },
        });
        if (dup) {
          return next(new AppError('Another role with this name already exists', 400));
        }
        role.name = trimmedName;
      }
    }

    if (description !== undefined) {
      role.description = description.trim();
    }

    if (Array.isArray(permissions)) {
      if (permissions.length === 0) {
        return next(new AppError('A role must contain at least one permission', 400));
      }
      const invalidPerms = permissions.filter((p) => !ALL_PERMISSION_IDS.includes(p));
      if (invalidPerms.length > 0) {
        return next(new AppError(`Invalid permissions: ${invalidPerms.join(', ')}`, 400));
      }
      role.permissions = permissions;
    }

    await role.save();

    // Immediately sync permissions to all staff members assigned to this role and bump sessionVersion
    await SellerStaff.updateMany(
      { sellerId, roleId: role._id },
      {
        $set: { permissions: role.permissions, role: role.name },
        $inc: { sessionVersion: 1 },
      }
    );

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'ROLE_UPDATE',
      entityType: 'SellerRole',
      entityId: role._id.toString(),
      entityIdentifier: role.name,
      previousValue: { name: oldName, permissionsCount: oldPermissions.length },
      updatedValue: { name: role.name, permissionsCount: role.permissions.length },
    });

    return success(res, role);
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/v1/seller/roles/:id
 * Deletes a custom role if no active staff members are assigned.
 */
router.delete('/roles/:id', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError('Invalid role ID', 400));
    }

    const role = await SellerRole.findOne({ _id: new mongoose.Types.ObjectId(id), sellerId });
    if (!role) {
      return next(new AppError('Role not found', 404));
    }

    if (role.isSystem) {
      return next(new AppError('Default system roles cannot be deleted', 400));
    }

    // Verify no non-removed staff members are assigned to this role
    const assignedCount = await SellerStaff.countDocuments({
      sellerId,
      roleId: role._id,
      status: { $ne: 'REMOVED' },
    });

    if (assignedCount > 0) {
      return next(
        new AppError(
          `Cannot delete role "${role.name}" because ${assignedCount} staff member(s) are assigned to it. Please reassign their roles first.`,
          400
        )
      );
    }

    await SellerRole.deleteOne({ _id: role._id });

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'ROLE_DELETE',
      entityType: 'SellerRole',
      entityId: id,
      entityIdentifier: role.name,
    });

    return success(res, { message: 'Role deleted successfully', roleId: id });
  } catch (e) {
    next(e);
  }
});

// ============================================================================
// STAFF MEMBERS MANAGEMENT (OWNER ONLY)
// ============================================================================

/**
 * GET /api/v1/seller/staff
 * Lists all staff members for the current store, computing invitation expiry status.
 */
router.get('/staff', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const staffList = await SellerStaff.find({
      sellerId,
      status: { $ne: 'REMOVED' },
    })
      .populate('roleId', 'name isSystem permissions')
      .sort({ createdAt: -1 })
      .lean();

    const now = Date.now();
    const enriched = staffList.map((s) => {
      const isExpired =
        s.status === 'PENDING' &&
        s.invitationExpiresAt &&
        new Date(s.invitationExpiresAt).getTime() < now;
      return {
        ...s,
        isExpired,
      };
    });

    return success(res, enriched);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/seller/staff
 * Adds a new staff member to the store with selected role, preventing duplicate active invites.
 */
router.post('/staff', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { name, phone, roleId } = req.body as {
      name?: string;
      phone?: string;
      roleId?: string;
    };

    if (!name?.trim()) {
      return next(new AppError('Staff name is required', 400));
    }
    const cleanPhone = phoneLast10(phone);
    if (!cleanPhone || cleanPhone.length !== 10) {
      return next(new AppError('A valid 10-digit mobile number is required', 400));
    }

    // Verify phone is not the owner's phone
    const store = await Seller.findById(sellerId);
    if (!store) {
      return next(new AppError('Store not found', 404));
    }
    const ownerPhone = phoneLast10(store.mobileNumber);
    if (ownerPhone === cleanPhone) {
      return next(new AppError('The shop owner is already an admin and cannot be added as staff', 400));
    }

    // Verify role belongs to store
    if (!roleId || !mongoose.Types.ObjectId.isValid(roleId)) {
      return next(new AppError('Please select a valid role for this staff member', 400));
    }
    const roleDoc = await SellerRole.findOne({
      _id: new mongoose.Types.ObjectId(roleId),
      sellerId,
    });
    if (!roleDoc) {
      return next(new AppError('Selected role does not exist in your store', 404));
    }

    // Check if staff member already exists for this store
    const existing = await SellerStaff.findOne({
      sellerId,
      phone: cleanPhone,
    });

    const now = new Date();
    const expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (existing) {
      if (['ACTIVE', 'ACCEPTED'].includes(existing.status)) {
        return next(
          new AppError('A staff member with this phone number is already active in your store', 400)
        );
      }
      if (existing.status === 'PENDING') {
        const isExpired =
          existing.invitationExpiresAt &&
          new Date(existing.invitationExpiresAt).getTime() < Date.now();
        if (!isExpired) {
          return next(
            new AppError(
              'An active invitation is already pending for this phone number. You can resend or manage it from the staff list.',
              400
            )
          );
        }
      }

      // Reactivate previously inactive / suspended / removed / expired staff member with new role
      existing.name = name.trim();
      existing.roleId = roleDoc._id;
      existing.role = roleDoc.name;
      existing.permissions = roleDoc.permissions;
      existing.status = 'PENDING';
      existing.invitedAt = now;
      existing.invitationExpiresAt = expiryDate;
      existing.sessionVersion = (existing.sessionVersion || 1) + 1;
      await existing.save();

      StaffActivityService.recordActivity({
        sellerId,
        staffId: req.user!.staffId,
        performedBy: req.user!.staffName || 'Shop Owner',
        performedByRole: req.user!.sellerRole || 'OWNER',
        module: 'staff',
        action: 'STAFF_INVITE_RENEWED',
        entityType: 'SellerStaff',
        entityId: existing._id.toString(),
        entityIdentifier: existing.name,
        updatedValue: { phone: existing.phone, role: existing.role },
      });

      return success(res, existing, 200);
    }

    const newStaff = await SellerStaff.create({
      sellerId,
      name: name.trim(),
      phone: cleanPhone,
      roleId: roleDoc._id,
      role: roleDoc.name,
      permissions: roleDoc.permissions,
      status: 'PENDING',
      addedBy: req.user!.sub,
      invitedAt: now,
      invitationExpiresAt: expiryDate,
      sessionVersion: 1,
    });

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'STAFF_INVITED',
      entityType: 'SellerStaff',
      entityId: newStaff._id.toString(),
      entityIdentifier: newStaff.name,
      updatedValue: { phone: newStaff.phone, role: newStaff.role },
    });

    return success(res, newStaff, 201);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/seller/staff/:id/resend-invite
 * Resets the 7-day invitation expiry and marks as PENDING.
 */
router.post('/staff/:id/resend-invite', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError('Invalid staff ID', 400));
    }

    const staff = await SellerStaff.findOne({ _id: new mongoose.Types.ObjectId(id), sellerId });
    if (!staff) {
      return next(new AppError('Staff member not found', 404));
    }

    if (staff.status !== 'PENDING') {
      return next(new AppError('Only pending or expired staff invitations can be resent', 400));
    }

    const now = new Date();
    staff.invitedAt = now;
    staff.invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    staff.status = 'PENDING';
    await staff.save();

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'STAFF_RESEND_INVITE',
      entityType: 'SellerStaff',
      entityId: staff._id.toString(),
      entityIdentifier: staff.name,
      updatedValue: { phone: staff.phone, invitationExpiresAt: staff.invitationExpiresAt },
    });

    return success(res, staff);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/seller/staff/:id/cancel-invite
 * Cancels a pending invitation and marks the record as REMOVED.
 */
router.post('/staff/:id/cancel-invite', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError('Invalid staff ID', 400));
    }

    const staff = await SellerStaff.findOne({ _id: new mongoose.Types.ObjectId(id), sellerId });
    if (!staff) {
      return next(new AppError('Staff member not found', 404));
    }

    if (staff.status !== 'PENDING') {
      return next(new AppError('Only pending invitations can be cancelled', 400));
    }

    staff.status = 'REMOVED';
    staff.sessionVersion = (staff.sessionVersion || 1) + 1;
    await staff.save();

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'STAFF_CANCEL_INVITE',
      entityType: 'SellerStaff',
      entityId: staff._id.toString(),
      entityIdentifier: staff.name,
    });

    return success(res, { message: 'Staff invitation cancelled successfully', staffId: id });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/seller/staff/:id/revoke-sessions
 * Remotely terminates all active logins for this staff member by bumping sessionVersion.
 */
router.post('/staff/:id/revoke-sessions', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError('Invalid staff ID', 400));
    }

    const staff = await SellerStaff.findOne({ _id: new mongoose.Types.ObjectId(id), sellerId });
    if (!staff) {
      return next(new AppError('Staff member not found', 404));
    }

    staff.sessionVersion = (staff.sessionVersion || 1) + 1;
    await staff.save();

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'STAFF_REVOKE_SESSIONS',
      entityType: 'SellerStaff',
      entityId: staff._id.toString(),
      entityIdentifier: staff.name,
      updatedValue: { sessionVersion: staff.sessionVersion },
    });

    return success(res, {
      message: `All active sessions for ${staff.name} have been revoked immediately.`,
      sessionVersion: staff.sessionVersion,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * PUT /api/v1/seller/staff/:id
 * Updates staff member name, phone, or assigned role.
 */
router.put('/staff/:id', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { id } = req.params;
    const { name, phone, roleId } = req.body as {
      name?: string;
      phone?: string;
      roleId?: string;
    };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError('Invalid staff ID', 400));
    }

    const staff = await SellerStaff.findOne({ _id: new mongoose.Types.ObjectId(id), sellerId });
    if (!staff) {
      return next(new AppError('Staff member not found', 404));
    }

    const previousData = { name: staff.name, phone: staff.phone, role: staff.role };

    if (name?.trim()) {
      staff.name = name.trim();
    }

    if (phone) {
      const cleanPhone = phoneLast10(phone);
      if (!cleanPhone || cleanPhone.length !== 10) {
        return next(new AppError('Please enter a valid 10-digit mobile number', 400));
      }
      if (cleanPhone !== staff.phone) {
        const dup = await SellerStaff.findOne({
          sellerId,
          phone: cleanPhone,
          status: { $ne: 'REMOVED' },
          _id: { $ne: staff._id },
        });
        if (dup) {
          return next(new AppError('Another staff member with this phone number already exists', 400));
        }
        staff.phone = cleanPhone;
        // Phone change resets userId binding and requires re-verification
        staff.userId = undefined;
        staff.status = 'PENDING';
        staff.invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        staff.sessionVersion = (staff.sessionVersion || 1) + 1;
      }
    }

    if (roleId && mongoose.Types.ObjectId.isValid(roleId)) {
      const roleDoc = await SellerRole.findOne({
        _id: new mongoose.Types.ObjectId(roleId),
        sellerId,
      });
      if (!roleDoc) {
        return next(new AppError('Selected role not found in this store', 404));
      }
      staff.roleId = roleDoc._id;
      staff.role = roleDoc.name;
      staff.permissions = roleDoc.permissions;
      staff.sessionVersion = (staff.sessionVersion || 1) + 1;
    }

    await staff.save();

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'STAFF_UPDATE',
      entityType: 'SellerStaff',
      entityId: staff._id.toString(),
      entityIdentifier: staff.name,
      previousValue: previousData,
      updatedValue: { name: staff.name, phone: staff.phone, role: staff.role },
    });

    return success(res, staff);
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/v1/seller/staff/:id/status
 * Enables, disables, or suspends a staff member.
 * Immediately invalidates sessions if deactivated, suspended, or removed.
 */
router.patch('/staff/:id/status', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { id } = req.params;
    const { status } = req.body as { status?: 'PENDING' | 'ACCEPTED' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'REMOVED' };

    if (!status || !['PENDING', 'ACCEPTED', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'REMOVED'].includes(status)) {
      return next(new AppError('Status must be PENDING, ACTIVE, INACTIVE, SUSPENDED, or REMOVED', 400));
    }

    const staff = await SellerStaff.findOne({
      _id: new mongoose.Types.ObjectId(id),
      sellerId,
    });

    if (!staff) {
      return next(new AppError('Staff member not found', 404));
    }

    const previousStatus = staff.status;
    staff.status = status;

    // Immediately revoke sessions when deactivated, suspended, or removed
    if (['INACTIVE', 'SUSPENDED', 'REMOVED'].includes(status)) {
      staff.sessionVersion = (staff.sessionVersion || 1) + 1;
    }

    await staff.save();

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'STAFF_STATUS_CHANGE',
      entityType: 'SellerStaff',
      entityId: staff._id.toString(),
      entityIdentifier: staff.name,
      previousValue: { status: previousStatus },
      updatedValue: { status: staff.status },
    });

    return success(res, staff);
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/v1/seller/staff/:id
 * Soft-removes a staff member from the store and revokes all sessions.
 */
router.delete('/staff/:id', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { id } = req.params;

    const staff = await SellerStaff.findOne({
      _id: new mongoose.Types.ObjectId(id),
      sellerId,
    });

    if (!staff) {
      return next(new AppError('Staff member not found', 404));
    }

    staff.status = 'REMOVED';
    staff.sessionVersion = (staff.sessionVersion || 1) + 1;
    await staff.save();

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: 'STAFF_REMOVE',
      entityType: 'SellerStaff',
      entityId: staff._id.toString(),
      entityIdentifier: staff.name,
    });

    return success(res, { message: 'Staff member removed successfully', staffId: id });
  } catch (e) {
    next(e);
  }
});

// ============================================================================
// AUDIT LOG & STAFF ACTIVITY HISTORY
// ============================================================================

/**
 * GET /api/v1/seller/staff/activity
 * Retrieves paginated audit logs of staff operations for the store.
 */
router.get('/staff/activity', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const history = await StaffActivityService.getActivityHistory(sellerId, req.query as any);
    return success(res, history);
  } catch (e) {
    next(e);
  }
});

// ============================================================================
// APPROVAL WORKFLOWS (PHASE 3 FOUNDATION)
// ============================================================================

/**
 * GET /api/v1/seller/staff/approvals
 * Lists approval requests for the store.
 */
router.get('/staff/approvals', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const status = req.query.status as string;
    const query: Record<string, any> = { sellerId };
    if (status) query.status = status;

    const requests = await StaffApprovalRequest.find(query).sort({ createdAt: -1 }).limit(50).lean();
    return success(res, requests);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/seller/staff/approvals
 * Staff submits a request for owner/manager approval for sensitive operations.
 */
router.post('/staff/approvals', ...requireSeller, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { requestType, entityType, entityId, entityIdentifier, details } = req.body as {
      requestType?: 'PRICE_CHANGE' | 'STOCK_ZERO' | 'HIGH_VALUE_REFUND' | 'ORDER_CANCEL' | 'CUSTOM';
      entityType?: string;
      entityId?: string;
      entityIdentifier?: string;
      details?: Record<string, any>;
    };

    if (!requestType || !entityType || !entityId) {
      return next(new AppError('requestType, entityType, and entityId are required', 400));
    }

    const created = await StaffApprovalRequest.create({
      sellerId,
      requestedBy: req.user!.staffId ? new mongoose.Types.ObjectId(req.user!.staffId) : undefined,
      requestedByName: req.user!.staffName || 'Staff Member',
      requestedByRole: req.user!.sellerRole || 'Staff',
      requestType,
      entityType,
      entityId,
      entityIdentifier: entityIdentifier || '',
      details: details || {},
      status: 'PENDING',
    });

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Staff Member',
      performedByRole: req.user!.sellerRole || 'Staff',
      module: 'staff',
      action: 'APPROVAL_REQUEST_SUBMITTED',
      entityType: 'StaffApprovalRequest',
      entityId: created._id.toString(),
      entityIdentifier: `${requestType} - ${entityIdentifier || entityId}`,
      updatedValue: { requestType, details },
    });

    return success(res, created, 201);
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/v1/seller/staff/approvals/:id
 * Store Owner reviews (APPROVE / REJECT) a pending sensitive operation request.
 */
router.patch('/staff/approvals/:id', ...requireOwner, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user!.sellerId!);
    const { id } = req.params;
    const { action, reviewNotes } = req.body as { action?: 'APPROVE' | 'REJECT'; reviewNotes?: string };

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return next(new AppError('Action must be APPROVE or REJECT', 400));
    }

    const approval = await StaffApprovalRequest.findOne({
      _id: new mongoose.Types.ObjectId(id),
      sellerId,
    });

    if (!approval) {
      return next(new AppError('Approval request not found', 404));
    }

    approval.status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    approval.reviewedBy = req.user!.staffName || 'Shop Owner';
    approval.reviewedAt = new Date();
    approval.reviewNotes = reviewNotes?.trim() || '';
    await approval.save();

    StaffActivityService.recordActivity({
      sellerId,
      staffId: req.user!.staffId,
      performedBy: req.user!.staffName || 'Shop Owner',
      performedByRole: req.user!.sellerRole || 'OWNER',
      module: 'staff',
      action: `APPROVAL_REQUEST_${action}D`,
      entityType: 'StaffApprovalRequest',
      entityId: approval._id.toString(),
      entityIdentifier: `${approval.requestType} - ${approval.entityIdentifier || approval.entityId}`,
      updatedValue: { status: approval.status, reviewNotes: approval.reviewNotes },
    });

    return success(res, approval);
  } catch (e) {
    next(e);
  }
});

export default router;
