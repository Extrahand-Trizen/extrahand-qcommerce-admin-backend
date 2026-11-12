import mongoose from 'mongoose';
import AdminUser from '../models/AdminUser';
import Seller from '../models/Seller';
import SellerOnboarding from '../models/SellerOnboarding';
import SellerAssignmentCounter from '../models/SellerAssignmentCounter';
import { EmailServiceClient } from './EmailServiceClient';
import { AppError } from '../utils/response';
import logger from '../config/logger';

export interface AssignedAdminSummary {
  id: string;
  name: string;
  email: string;
  receivesSellerAssignments?: boolean;
}

export interface ScopedAdminActor {
  sub?: string;
  role?: string;
}

const ROUND_ROBIN_COUNTER_ID = 'seller_ops_round_robin';

/**
 * Handles round-robin and manual assignment of sellers to active
 * Seller Operations Admins for onboarding and follow-up support.
 */
export class SellerAssignmentService {
  /**
   * Returns the admin's ObjectId when requests must be scoped to assigned sellers
   * (SELLER_OPERATIONS_ADMIN), or null for unrestricted roles (SUPER_ADMIN, etc.).
   */
  static getScopedAdminObjectId(actor?: ScopedAdminActor): mongoose.Types.ObjectId | null {
    if (actor?.role !== 'SELLER_OPERATIONS_ADMIN') return null;
    if (!actor.sub || !mongoose.isValidObjectId(actor.sub)) {
      throw new AppError('Invalid admin identity for scoped seller access', 403);
    }
    return new mongoose.Types.ObjectId(actor.sub);
  }

  /**
   * Enforce that a SELLER_OPERATIONS_ADMIN can only access/manage sellers assigned to them.
   * No-op for SUPER_ADMIN and other non-ops roles.
   */
  static async assertSellerAccess(
    sellerIdOrOnboardingId: string,
    actor?: ScopedAdminActor,
  ): Promise<void> {
    const scopedAdminId = this.getScopedAdminObjectId(actor);
    if (!scopedAdminId) return;

    if (!mongoose.isValidObjectId(sellerIdOrOnboardingId)) {
      throw new AppError('Seller not found', 404);
    }

    let seller = await Seller.findById(sellerIdOrOnboardingId).select('_id assignedAdminId').lean();
    if (!seller) {
      const onboarding = await SellerOnboarding.findById(sellerIdOrOnboardingId).select('sellerId').lean();
      if (onboarding?.sellerId) {
        seller = await Seller.findById(onboarding.sellerId).select('_id assignedAdminId').lean();
      }
    }

    if (!seller) {
      throw new AppError('Seller not found', 404);
    }

    if (!seller.assignedAdminId || seller.assignedAdminId.toString() !== scopedAdminId.toString()) {
      throw new AppError('Access denied: This seller is not assigned to you', 403);
    }
  }

  /**
   * Batch-load assigned admin summaries keyed by admin ObjectId string.
   */
  static async getAssignedAdminMap(
    adminIds: Array<string | mongoose.Types.ObjectId | null | undefined>,
  ): Promise<Map<string, AssignedAdminSummary>> {
    const uniqueIds = [
      ...new Set(
        adminIds
          .map((id) => (id ? String(id) : ''))
          .filter((id) => id && mongoose.isValidObjectId(id)),
      ),
    ];

    if (uniqueIds.length === 0) return new Map();

    const admins = await AdminUser.find({ _id: { $in: uniqueIds } })
      .select('_id name email receivesSellerAssignments')
      .lean();

    return new Map(
      admins.map((a) => [
        a._id.toString(),
        {
          id: a._id.toString(),
          name: a.name,
          email: a.email,
          receivesSellerAssignments: a.receivesSellerAssignments !== false,
        },
      ]),
    );
  }
  /**
   * Atomically allocate the next active, opted-in SELLER_OPERATIONS_ADMIN in
   * round-robin order and assign them if the seller is currently unassigned.
   * Best-effort: returns null rather than throwing if already assigned or no eligible admin exists.
   */
  static async assignNextSellerOpsAdmin(
    sellerId: string | mongoose.Types.ObjectId,
  ): Promise<AssignedAdminSummary | null> {
    const unassignedFilter = {
      _id: sellerId,
      $or: [{ assignedAdminId: null }, { assignedAdminId: { $exists: false } }],
    };

    const existingUnassigned = await Seller.findOne(unassignedFilter).select('_id').lean();
    if (!existingUnassigned) {
      return null;
    }

    const counter = await SellerAssignmentCounter.findOneAndUpdate(
      { _id: ROUND_ROBIN_COUNTER_ID },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const now = new Date();
    const admin = await AdminUser.findOneAndUpdate(
      {
        role: 'SELLER_OPERATIONS_ADMIN',
        status: 'active',
        isActive: true,
        receivesSellerAssignments: { $ne: false },
      },
      {
        $set: {
          lastSellerAssignedSeq: counter.seq,
          lastSellerAssignedAt: now,
        },
      },
      {
        sort: { lastSellerAssignedSeq: 1, createdAt: 1, _id: 1 },
        new: true,
      },
    ).select('_id name email receivesSellerAssignments');

    if (!admin) {
      logger.warn('Round-robin seller assignment skipped: no eligible active SELLER_OPERATIONS_ADMIN found', {
        sellerId: String(sellerId),
      });
      return null;
    }

    const seller = await Seller.findOneAndUpdate(
      unassignedFilter,
      {
        $set: {
          assignedAdminId: admin._id,
          assignedAt: now,
          assignedBy: 'ROUND_ROBIN',
        },
      },
      { new: true },
    ).select('_id fullName mobileNumber email onboardingStatus');

    if (!seller) {
      return null;
    }

    logger.info('Seller assigned via round-robin', {
      sellerId: String(sellerId),
      assignedAdminId: admin._id.toString(),
      assignedAdminEmail: admin.email,
      seq: counter.seq,
    });

    const onboarding = await SellerOnboarding.findOne({ sellerId: seller._id })
      .select('shopName')
      .lean();

    void EmailServiceClient.sendSellerAssignedEmail({
      adminEmail: admin.email,
      adminName: admin.name,
      sellerId: seller._id.toString(),
      sellerName: seller.fullName,
      sellerPhone: seller.mobileNumber,
      sellerEmail: seller.email,
      shopName: onboarding?.shopName,
      onboardingStatus: seller.onboardingStatus,
      assignmentType: 'ROUND_ROBIN',
      assignedAt: now,
    });

    return {
      id: admin._id.toString(),
      name: admin.name,
      email: admin.email,
      receivesSellerAssignments: admin.receivesSellerAssignments !== false,
    };
  }

  /**
   * Non-throwing wrapper around assignNextSellerOpsAdmin for lifecycle hooks
   * (registration, onboarding submission, approval, admin creation).
   */
  static async assignIfUnassignedBestEffort(
    sellerId: string | mongoose.Types.ObjectId,
    context: string,
  ): Promise<AssignedAdminSummary | null> {
    try {
      return await this.assignNextSellerOpsAdmin(sellerId);
    } catch (err: any) {
      logger.error(`Failed to round-robin assign seller during ${context} (non-fatal)`, {
        sellerId: String(sellerId),
        error: err?.message || err,
      });
      return null;
    }
  }

  /**
   * Assign or reassign a seller to a specific active SELLER_OPERATIONS_ADMIN
   * (or pass null/empty to clear the assignment).
   */
  static async assignSellerToAdmin(
    sellerId: string,
    targetAdminId: string | null | undefined,
    assignedByUserId: string,
  ): Promise<{
    sellerId: string;
    assignedAdmin: AssignedAdminSummary | null;
    assignedAt: Date | null;
    assignedBy: string | null;
    changed: boolean;
  }> {
    if (!mongoose.isValidObjectId(sellerId)) {
      throw new AppError('Invalid seller ID', 400);
    }

    const seller = await Seller.findById(sellerId);
    if (!seller || seller.status === 'DELETED') {
      throw new AppError('Seller not found', 404);
    }

    const normalizedTarget = typeof targetAdminId === 'string' ? targetAdminId.trim() : '';
    const previousAdminId = seller.assignedAdminId ? seller.assignedAdminId.toString() : null;

    if (!normalizedTarget) {
      seller.assignedAdminId = null;
      seller.assignedAt = null;
      seller.assignedBy = null;
      await seller.save();

      return {
        sellerId: seller._id.toString(),
        assignedAdmin: null,
        assignedAt: null,
        assignedBy: null,
        changed: previousAdminId !== null,
      };
    }

    if (!mongoose.isValidObjectId(normalizedTarget)) {
      throw new AppError('Invalid Seller Operations Admin ID', 400);
    }

    const targetAdmin = await AdminUser.findOne({
      _id: normalizedTarget,
      role: 'SELLER_OPERATIONS_ADMIN',
      status: 'active',
      isActive: true,
    }).select('_id name email receivesSellerAssignments');

    if (!targetAdmin) {
      throw new AppError('Target user must be an active Seller Operations Admin', 400);
    }

    const now = new Date();
    const changed = previousAdminId !== targetAdmin._id.toString();
    seller.assignedAdminId = targetAdmin._id as mongoose.Types.ObjectId;
    seller.assignedAt = now;
    seller.assignedBy = assignedByUserId;
    await Promise.all([
      seller.save(),
      AdminUser.updateOne(
        { _id: targetAdmin._id },
        { $set: { lastSellerAssignedAt: now } },
      ),
    ]);

    if (changed) {
      const onboarding = await SellerOnboarding.findOne({ sellerId: seller._id })
        .select('shopName')
        .lean();

      void EmailServiceClient.sendSellerAssignedEmail({
        adminEmail: targetAdmin.email,
        adminName: targetAdmin.name,
        sellerId: seller._id.toString(),
        sellerName: seller.fullName,
        sellerPhone: seller.mobileNumber,
        sellerEmail: seller.email,
        shopName: onboarding?.shopName,
        onboardingStatus: seller.onboardingStatus,
        assignmentType: 'MANUAL',
        assignedAt: now,
      });
    }

    return {
      sellerId: seller._id.toString(),
      assignedAdmin: {
        id: targetAdmin._id.toString(),
        name: targetAdmin.name,
        email: targetAdmin.email,
        receivesSellerAssignments: targetAdmin.receivesSellerAssignments !== false,
      },
      assignedAt: now,
      assignedBy: assignedByUserId,
      changed,
    };
  }

  /**
   * List SELLER_OPERATIONS_ADMIN users along with their current assigned seller count.
   * By default returns only active admins (for assignment dropdowns); pass includeInactive=true
   * for the Follow-Up management tab.
   */
  static async listSupportAdmins(includeInactive = false) {
    const query: Record<string, unknown> = {
      role: 'SELLER_OPERATIONS_ADMIN',
    };
    if (!includeInactive) {
      query.status = 'active';
      query.isActive = true;
    }

    const [admins, sellerStats] = await Promise.all([
      AdminUser.find(query)
        .select('_id name email status isActive receivesSellerAssignments lastSellerAssignedAt createdAt')
        .sort({ createdAt: -1, name: 1 })
        .lean(),
      Seller.aggregate<{ _id: mongoose.Types.ObjectId; count: number; lastAssignedAt: Date | null }>([
        { $match: { assignedAdminId: { $ne: null }, status: { $ne: 'DELETED' } } },
        {
          $group: {
            _id: '$assignedAdminId',
            count: { $sum: 1 },
            lastAssignedAt: { $max: '$assignedAt' },
          },
        },
      ]),
    ]);

    const statsMap = new Map(sellerStats.map((c) => [c._id.toString(), c]));

    return admins.map((a) => {
      const stat = statsMap.get(a._id.toString());
      const adminTs = a.lastSellerAssignedAt ? new Date(a.lastSellerAssignedAt).getTime() : 0;
      const sellerTs = stat?.lastAssignedAt ? new Date(stat.lastAssignedAt).getTime() : 0;
      const latestTs = Math.max(adminTs, sellerTs);

      return {
        id: a._id.toString(),
        name: a.name,
        email: a.email,
        status: a.status || (a.isActive ? 'active' : 'inactive'),
        isActive: a.isActive ?? (a.status === 'active'),
        receivesSellerAssignments: a.receivesSellerAssignments !== false,
        lastSellerAssignedAt: latestTs > 0 ? new Date(latestTs) : null,
        createdAt: a.createdAt,
        assignedSellerCount: stat?.count ?? 0,
      };
    });
  }
}

