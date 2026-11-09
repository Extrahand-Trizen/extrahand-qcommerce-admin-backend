import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IStaffApprovalRequest extends Document {
  sellerId: Types.ObjectId;
  requestedBy: Types.ObjectId;
  requestedByName: string;
  requestedByRole: string;
  requestType: 'PRICE_CHANGE' | 'STOCK_ZERO' | 'HIGH_VALUE_REFUND' | 'ORDER_CANCEL' | 'CUSTOM';
  entityType: string;
  entityId: string;
  entityIdentifier?: string;
  details: Record<string, any>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StaffApprovalRequestSchema = new Schema<IStaffApprovalRequest>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'SellerStaff', required: true, index: true },
    requestedByName: { type: String, required: true },
    requestedByRole: { type: String, required: true },
    requestType: {
      type: String,
      enum: ['PRICE_CHANGE', 'STOCK_ZERO', 'HIGH_VALUE_REFUND', 'ORDER_CANCEL', 'CUSTOM'],
      required: true,
      index: true,
    },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    entityIdentifier: { type: String, default: '' },
    details: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    reviewNotes: { type: String, default: '' },
  },
  { timestamps: true }
);

StaffApprovalRequestSchema.index({ sellerId: 1, status: 1, createdAt: -1 });

export default mongoose.model<IStaffApprovalRequest>('StaffApprovalRequest', StaffApprovalRequestSchema);

