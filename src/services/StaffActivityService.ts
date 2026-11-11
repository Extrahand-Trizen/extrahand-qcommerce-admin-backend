import mongoose, { Types } from 'mongoose';
import StaffActivityLog, { IStaffActivityLog } from '../models/StaffActivityLog';
import logger from '../config/logger';

export interface RecordActivityInput {
  sellerId: string | Types.ObjectId;
  staffId?: string | Types.ObjectId | null;
  performedBy: string;
  performedByRole: string;
  module: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityIdentifier?: string;
  previousValue?: any;
  updatedValue?: any;
  ipAddress?: string;
  deviceInfo?: string;
  metadata?: Record<string, any>;
}

export interface ActivityFilterInput {
  staffId?: string;
  module?: string;
  action?: string;
  page?: number;
  limit?: number;
}

export class StaffActivityService {
  /**
   * Records a staff or owner operation asynchronously without blocking calling request.
   */
  static async recordActivity(input: RecordActivityInput): Promise<void> {
    try {
      const sellerIdObj =
        typeof input.sellerId === 'string'
          ? new mongoose.Types.ObjectId(input.sellerId)
          : input.sellerId;

      const staffIdObj =
        input.staffId && mongoose.Types.ObjectId.isValid(input.staffId.toString())
          ? new mongoose.Types.ObjectId(input.staffId.toString())
          : undefined;

      await StaffActivityLog.create({
        sellerId: sellerIdObj,
        staffId: staffIdObj,
        performedBy: input.performedBy || 'Unknown User',
        performedByRole: input.performedByRole || 'Staff',
        module: input.module,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId || '',
        entityIdentifier: input.entityIdentifier || '',
        previousValue: input.previousValue,
        updatedValue: input.updatedValue,
        ipAddress: input.ipAddress || '',
        deviceInfo: input.deviceInfo || '',
        metadata: input.metadata || {},
      });
    } catch (err) {
      logger.error('Failed to record staff activity log', {
        error: (err as Error).message,
        input,
      });
    }
  }

  /**
   * Retrieves paginated activity logs for a store with optional filters.
   */
  static async getActivityHistory(
    sellerId: string | Types.ObjectId,
    filters: ActivityFilterInput = {}
  ): Promise<{ logs: IStaffActivityLog[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 30));
    const skip = (page - 1) * limit;

    const query: Record<string, any> = {
      sellerId: typeof sellerId === 'string' ? new mongoose.Types.ObjectId(sellerId) : sellerId,
    };

    if (filters.staffId && mongoose.Types.ObjectId.isValid(filters.staffId)) {
      query.staffId = new mongoose.Types.ObjectId(filters.staffId);
    }

    if (filters.module?.trim()) {
      query.module = filters.module.trim();
    }

    if (filters.action?.trim()) {
      query.action = filters.action.trim();
    }

    const [logs, total] = await Promise.all([
      StaffActivityLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      StaffActivityLog.countDocuments(query),
    ]);

    return {
      logs: logs as unknown as IStaffActivityLog[],
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}

