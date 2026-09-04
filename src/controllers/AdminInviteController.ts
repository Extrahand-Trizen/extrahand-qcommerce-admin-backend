import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import AdminInvite from '../models/AdminInvite';
import AdminUser from '../models/AdminUser';
import { AuthRequest } from '../middleware/auth';
import { success, error } from '../utils/response';
import { env } from '../config/env';
import { ADMIN_ROLES, AdminRole } from '../types';
import logger from '../config/logger';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  CATALOGUE_ADMIN: 'Catalogue Admin',
  SELLER_OPERATIONS_ADMIN: 'Seller Operations Admin',
  ADMIN: 'Super Admin',
};

export class AdminInviteController {
  /**
   * Helper to dispatch admin invite email to email service
   */
  private static async sendInviteEmail(data: {
    email: string;
    name: string;
    role: string;
    token: string;
    inviteId: string;
    expiresAt: Date;
    inviterId: string;
  }): Promise<void> {
    if (!env.EMAIL_SERVICE_URL) {
      throw new Error('EMAIL_SERVICE_URL is not configured');
    }

    try {
      const frontendUrl = env.FRONTEND_URL || 'http://localhost:3001';
      const inviteUrl = `${frontendUrl.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(
        data.token
      )}&inviteId=${encodeURIComponent(data.inviteId)}`;

      const emailAuthToken = env.EMAIL_SERVICE_AUTH_TOKEN || env.SERVICE_AUTH_TOKEN;

      const response = await fetch(`${env.EMAIL_SERVICE_URL.replace(/\/$/, '')}/api/v1/email/admin-invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(emailAuthToken ? { 'X-Service-Auth': emailAuthToken } : {}),
          'X-Service-Name': 'qcommerce-admin-backend',
          'X-User-Id': data.inviterId,
        },
        body: JSON.stringify({
          email: data.email,
          role: ROLE_LABELS[data.role] || data.role,
          inviteLink: inviteUrl,
          expiresAt: data.expiresAt,
          name: data.name,
          platformName: 'ExtraHand Quick Commerce Admin',
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Email service responded with ${response.status}: ${errText || 'request failed'}`);
      }

      const result = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        throw new Error(result?.error || 'Email service did not send the invitation');
      }
    } catch (err: any) {
      logger.error('Failed to communicate with email service:', err?.message || err);
    }
  }

  /**
   * POST /api/v1/admin/invites
   * Create admin invite (Super Admin only)
   */
  static async createInvite(req: AuthRequest, res: Response): Promise<any> {
    try {
      const { name, email, role } = req.body as {
        name?: string;
        email?: string;
        role?: AdminRole;
      };

      if (!name || !name.trim()) {
        return error(res, 'Name is required', 400);
      }

      if (!email || !email.trim()) {
        return error(res, 'Email is required', 400);
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const normalizedEmail = email.trim().toLowerCase();
      if (!emailRegex.test(normalizedEmail)) {
        return error(res, 'Invalid email address', 400);
      }

      if (!role || !ADMIN_ROLES.includes(role)) {
        return error(res, `Role is required and must be one of: ${ADMIN_ROLES.join(', ')}`, 400);
      }

      // Check if user already exists
      const existingUser = await AdminUser.findOne({ email: normalizedEmail });
      if (existingUser) {
        return error(res, 'A user with this email already exists', 400);
      }

      // Check for active pending invite
      const existingInvite = await AdminInvite.findOne({
        email: normalizedEmail,
        status: 'pending',
      });

      if (existingInvite && !existingInvite.isExpired()) {
        return error(res, 'A pending invitation already exists for this email', 400);
      }

      // Create new invite
      const { invite, token } = await (AdminInvite as any).createInvite({
        name: name.trim(),
        email: normalizedEmail,
        role,
        invitedBy: req.user!.sub,
        invitedByName: req.user!.name || 'Super Admin',
        expiresInDays: 7,
      });

      // Wait for the email service so a failed delivery is visible to the caller.
      await AdminInviteController.sendInviteEmail({
        email: invite.email,
        name: invite.name,
        role: invite.role,
        token,
        inviteId: invite.inviteId,
        expiresAt: invite.expiresAt,
        inviterId: req.user!.sub,
      });

      return success(
        res,
        {
          inviteId: invite.inviteId,
          name: invite.name,
          email: invite.email,
          role: invite.role,
          roleLabel: ROLE_LABELS[invite.role] || invite.role,
          status: invite.status,
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
        },
        201
      );
    } catch (err: any) {
      logger.error('Create admin invite error:', err);
      return error(res, 'Failed to create invitation', 500);
    }
  }

  /**
   * GET /api/v1/admin/invites
   * List admin invites with pagination and status filter (Super Admin only)
   */
  static async listInvites(req: AuthRequest, res: Response): Promise<any> {
    try {
      const { page = 1, limit = 20, status, role, search } = req.query;

      const query: any = {};

      if (status && typeof status === 'string') {
        query.status = status;
      }

      if (role && typeof role === 'string') {
        query.role = role;
      }

      if (search && typeof search === 'string' && search.trim()) {
        const regex = { $regex: search.trim(), $options: 'i' };
        query.$or = [{ email: regex }, { name: regex }];
      }

      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));
      const skip = (pageNum - 1) * limitNum;

      const [invites, total] = await Promise.all([
        AdminInvite.find(query)
          .select('-token')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        AdminInvite.countDocuments(query),
      ]);

      const formattedInvites = invites.map((inv) => {
        // Automatically check if pending invite has expired
        let effectiveStatus = inv.status;
        if (effectiveStatus === 'pending' && inv.isExpired()) {
          effectiveStatus = 'expired';
        }

        return {
          id: inv._id.toString(),
          inviteId: inv.inviteId,
          name: inv.name,
          email: inv.email,
          role: inv.role,
          roleLabel: ROLE_LABELS[inv.role] || inv.role,
          invitedBy: inv.invitedBy,
          invitedByName: inv.invitedByName,
          status: effectiveStatus,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
          acceptedAt: inv.acceptedAt,
        };
      });

      return success(res, {
        invites: formattedInvites,
        pagination: {
          total,
          pages: Math.ceil(total / limitNum),
          page: pageNum,
          limit: limitNum,
        },
      });
    } catch (err: any) {
      logger.error('List admin invites error:', err);
      return error(res, 'Failed to list invitations', 500);
    }
  }

  /**
   * POST /api/v1/admin/invites/:inviteId/resend
   * Resend admin invite (Super Admin only)
   */
  static async resendInvite(req: AuthRequest, res: Response): Promise<any> {
    try {
      const { inviteId } = req.params;

      const invite = await AdminInvite.findOne({ inviteId });
      if (!invite) {
        return error(res, 'Invitation not found', 404);
      }

      if (invite.status !== 'pending') {
        return error(res, 'Can only resend pending invitations', 400);
      }

      // Generate new token & extend expiration by 7 days
      const newToken = uuidv4();
      invite.token = await bcrypt.hash(newToken, 10);
      const newExpires = new Date();
      newExpires.setDate(newExpires.getDate() + 7);
      invite.expiresAt = newExpires;
      await invite.save();

      // Wait for the email service so a failed delivery is visible to the caller.
      await AdminInviteController.sendInviteEmail({
        email: invite.email,
        name: invite.name,
        role: invite.role,
        token: newToken,
        inviteId: invite.inviteId,
        expiresAt: invite.expiresAt,
        inviterId: req.user!.sub,
      });

      return success(res, {
        message: 'Invitation resent successfully',
        expiresAt: invite.expiresAt,
      });
    } catch (err: any) {
      logger.error('Resend admin invite error:', err);
      return error(res, 'Failed to resend invitation', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/invites/:inviteId
   * Cancel admin invite (Super Admin only)
   */
  static async cancelInvite(req: AuthRequest, res: Response): Promise<any> {
    try {
      const { inviteId } = req.params;

      const invite = await AdminInvite.findOne({ inviteId });
      if (!invite) {
        return error(res, 'Invitation not found', 404);
      }

      if (invite.status !== 'pending') {
        return error(res, 'Can only cancel pending invitations', 400);
      }

      invite.status = 'cancelled';
      await invite.save();

      return success(res, {
        message: 'Invitation cancelled successfully',
      });
    } catch (err: any) {
      logger.error('Cancel admin invite error:', err);
      return error(res, 'Failed to cancel invitation', 500);
    }
  }

  /**
   * POST /api/v1/invites/:inviteId/accept
   * Accept invite and activate account (Public endpoint)
   */
  static async acceptInvite(req: Request, res: Response): Promise<any> {
    try {
      const { inviteId } = req.params;
      const { token, password, name } = req.body as {
        token?: string;
        password?: string;
        name?: string;
      };

      if (!token || !password) {
        return error(res, 'Token and password are required', 400);
      }

      if (password.length < 6) {
        return error(res, 'Password must be at least 6 characters long', 400);
      }

      const invite = await AdminInvite.findOne({ inviteId });
      if (!invite) {
        return error(res, 'Invitation not found', 404);
      }

      if (!invite.canBeAccepted()) {
        return error(res, 'Invitation is expired or has already been used', 400);
      }

      const isValidToken = await invite.verifyToken(token);
      if (!isValidToken) {
        return error(res, 'Invalid invitation token', 400);
      }

      // Check if user already exists
      const existingUser = await AdminUser.findOne({ email: invite.email.toLowerCase() });
      if (existingUser) {
        return error(res, 'A user with this email is already registered', 400);
      }

      // Hash password and create admin user
      const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
      const user = await AdminUser.create({
        name: (name && name.trim()) || invite.name,
        email: invite.email.toLowerCase(),
        passwordHash,
        role: invite.role,
        status: 'active',
        isActive: true,
      });

      // Update invite status
      invite.status = 'accepted';
      invite.acceptedAt = new Date();
      invite.acceptedBy = user._id.toString();
      await invite.save();

      return success(res, {
        message: 'Invitation accepted successfully. You can now log in.',
        user: {
          id: user._id.toString(),
          userId: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          roleLabel: ROLE_LABELS[user.role] || user.role,
        },
      });
    } catch (err: any) {
      logger.error('Accept admin invite error:', err);
      return error(res, 'Failed to accept invitation', 500);
    }
  }
}
