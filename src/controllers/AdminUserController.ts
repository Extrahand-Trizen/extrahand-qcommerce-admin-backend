import { Response } from 'express';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import AdminUser from '../models/AdminUser';
import { AuthRequest } from '../middleware/auth';
import { success, error } from '../utils/response';
import { env } from '../config/env';
import { ADMIN_ROLES, AdminRole, ADMIN_STATUS, AdminStatus } from '../types';
import logger from '../config/logger';

export class AdminUserController {
  /**
   * Helper to find user by either MongoDB _id or userId string
   */
  private static async findUserById(id: string) {
    if (mongoose.isValidObjectId(id)) {
      const user = await AdminUser.findById(id);
      if (user) return user;
    }
    return AdminUser.findOne({ $or: [{ _id: id as any }, { email: id.toLowerCase() }] });
  }

  /**
   * Count remaining active super admins
   */
  private static async countActiveSuperAdmins(): Promise<number> {
    return AdminUser.countDocuments({
      role: { $in: ['SUPER_ADMIN', 'ADMIN'] },
      $or: [{ status: 'active' }, { isActive: true }],
    });
  }

  /**
   * GET /api/v1/admin/users
   * List admin users with pagination, search, role, and status filters
   */
  static async listUsers(req: AuthRequest, res: Response): Promise<any> {
    try {
      const { page = 1, limit = 20, search, role, status } = req.query;

      const query: any = {};

      if (search && typeof search === 'string' && search.trim()) {
        const regex = { $regex: search.trim(), $options: 'i' };
        query.$or = [{ email: regex }, { name: regex }];
      }

      if (role && typeof role === 'string') {
        if (role === 'SUPER_ADMIN') {
          query.role = { $in: ['SUPER_ADMIN', 'ADMIN'] };
        } else {
          query.role = role;
        }
      }

      if (status && typeof status === 'string') {
        query.status = status;
      }

      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));
      const skip = (pageNum - 1) * limitNum;

      const [users, total] = await Promise.all([
        AdminUser.find(query)
          .select('-passwordHash')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        AdminUser.countDocuments(query),
      ]);

      const formattedUsers = users.map((u) => ({
        id: u._id.toString(),
        userId: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role === 'ADMIN' ? 'SUPER_ADMIN' : u.role,
        status: u.status || (u.isActive ? 'active' : 'inactive'),
        isActive: u.isActive ?? (u.status === 'active'),
        isSuperAdmin: u.role === 'SUPER_ADMIN' || u.role === 'ADMIN',
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      }));

      return success(res, {
        users: formattedUsers,
        pagination: {
          total,
          pages: Math.ceil(total / limitNum),
          page: pageNum,
          limit: limitNum,
        },
      });
    } catch (err: any) {
      logger.error('List admin users error:', err);
      return error(res, 'Failed to list admin users', 500);
    }
  }

  /**
   * GET /api/v1/admin/users/:id
   * Get admin user details
   */
  static async getUser(req: AuthRequest, res: Response): Promise<any> {
    try {
      const { id } = req.params;
      const user = await AdminUserController.findUserById(id);

      if (!user) {
        return error(res, 'Admin user not found', 404);
      }

      return success(res, {
        id: user._id.toString(),
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role === 'ADMIN' ? 'SUPER_ADMIN' : user.role,
        status: user.status || (user.isActive ? 'active' : 'inactive'),
        isActive: user.isActive ?? (user.status === 'active'),
        isSuperAdmin: user.role === 'SUPER_ADMIN' || user.role === 'ADMIN',
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      });
    } catch (err: any) {
      logger.error('Get admin user error:', err);
      return error(res, 'Failed to get admin user', 500);
    }
  }

  /**
   * PATCH/PUT /api/v1/admin/users/:id
   * Update admin user (name, status, role, password)
   */
  static async updateUser(req: AuthRequest, res: Response): Promise<any> {
    try {
      const { id } = req.params;
      const { name, status, role, password } = req.body as {
        name?: string;
        status?: AdminStatus;
        role?: AdminRole;
        password?: string;
      };

      const user = await AdminUserController.findUserById(id);
      if (!user) {
        return error(res, 'Admin user not found', 404);
      }

      const isCurrentActiveSuperAdmin =
        (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') &&
        (user.status === 'active' || user.isActive);

      // Status change validation
      if (status && status !== user.status) {
        if (!ADMIN_STATUS.includes(status)) {
          return error(res, `Invalid status. Must be one of: ${ADMIN_STATUS.join(', ')}`, 400);
        }

        if (status === 'inactive' || status === 'suspended') {
          // Prevent self-deactivation
          if (user._id.toString() === req.user!.sub) {
            return error(res, 'Cannot deactivate or suspend your own account', 400);
          }

          // Prevent deactivating the last active super admin
          if (isCurrentActiveSuperAdmin) {
            const activeSuperAdmins = await AdminUserController.countActiveSuperAdmins();
            if (activeSuperAdmins <= 1) {
              return error(res, 'Cannot deactivate the last active Super Admin', 400);
            }
          }
        }

        user.status = status;
        user.isActive = status === 'active';
      }

      // Role change validation
      if (role && role !== user.role) {
        if (!ADMIN_ROLES.includes(role)) {
          return error(res, `Invalid role. Must be one of: ${ADMIN_ROLES.join(', ')}`, 400);
        }

        if (isCurrentActiveSuperAdmin && role !== 'SUPER_ADMIN') {
          // Prevent self-demotion from super admin
          if (user._id.toString() === req.user!.sub) {
            return error(res, 'Cannot change your own role away from Super Admin', 400);
          }

          // Prevent changing the role of the last active super admin
          const activeSuperAdmins = await AdminUserController.countActiveSuperAdmins();
          if (activeSuperAdmins <= 1) {
            return error(res, 'Cannot change the role of the last active Super Admin', 400);
          }
        }

        user.role = role;
      }

      if (name && typeof name === 'string' && name.trim()) {
        user.name = name.trim();
      }

      if (password && typeof password === 'string' && password.length >= 6) {
        user.passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
      }

      await user.save();

      return success(res, {
        id: user._id.toString(),
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role === 'ADMIN' ? 'SUPER_ADMIN' : user.role,
        status: user.status,
        isActive: user.isActive,
        isSuperAdmin: user.role === 'SUPER_ADMIN' || user.role === 'ADMIN',
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      });
    } catch (err: any) {
      logger.error('Update admin user error:', err);
      return error(res, 'Failed to update admin user', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/users/:id
   * Delete an admin user
   */
  static async deleteUser(req: AuthRequest, res: Response): Promise<any> {
    try {
      const { id } = req.params;

      const user = await AdminUserController.findUserById(id);
      if (!user) {
        return error(res, 'Admin user not found', 404);
      }

      // Prevent self-deletion
      if (user._id.toString() === req.user!.sub) {
        return error(res, 'Cannot delete your own account', 400);
      }

      // Prevent deleting the last active Super Admin
      const isCurrentActiveSuperAdmin =
        (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') &&
        (user.status === 'active' || user.isActive);

      if (isCurrentActiveSuperAdmin) {
        const activeSuperAdmins = await AdminUserController.countActiveSuperAdmins();
        if (activeSuperAdmins <= 1) {
          return error(res, 'Cannot delete the last active Super Admin', 400);
        }
      }

      await AdminUser.deleteOne({ _id: user._id });

      return success(res, {
        message: 'Admin user deleted successfully',
      });
    } catch (err: any) {
      logger.error('Delete admin user error:', err);
      return error(res, 'Failed to delete admin user', 500);
    }
  }
}
