import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IStaffActivityLog extends Document {
  sellerId: Types.ObjectId;
  staffId?: Types.ObjectId;
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
  createdAt: Date;
}

const StaffActivityLogSchema = new Schema<IStaffActivityLog>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'SellerStaff', index: true },
    performedBy: { type: String, required: true },
    performedByRole: { type: String, required: true },
    module: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: '' },
    entityIdentifier: { type: String, default: '' },
    previousValue: { type: Schema.Types.Mixed },
    updatedValue: { type: Schema.Types.Mixed },
    ipAddress: { type: String, default: '' },
    deviceInfo: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

StaffActivityLogSchema.index({ sellerId: 1, createdAt: -1 });
StaffActivityLogSchema.index({ sellerId: 1, staffId: 1, createdAt: -1 });
StaffActivityLogSchema.index({ sellerId: 1, module: 1, createdAt: -1 });

export default mongoose.model<IStaffActivityLog>('StaffActivityLog', StaffActivityLogSchema);

