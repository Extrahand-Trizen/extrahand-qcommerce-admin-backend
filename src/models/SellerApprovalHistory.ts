import mongoose, { Schema, Document, Types } from 'mongoose';
import { APPROVAL_ACTIONS, ApprovalAction } from '../types';

export interface ISellerApprovalHistory extends Document {
  sellerId: Types.ObjectId;
  onboardingId: Types.ObjectId;
  action: ApprovalAction;
  previousStatus?: string;
  newStatus: string;
  comment?: string;
  performedBy: string;
  performedAt: Date;
}

const SellerApprovalHistorySchema = new Schema<ISellerApprovalHistory>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    onboardingId: { type: Schema.Types.ObjectId, ref: 'SellerOnboarding', required: true, index: true },
    action: { type: String, enum: APPROVAL_ACTIONS, required: true },
    previousStatus: { type: String },
    newStatus: { type: String, required: true },
    comment: { type: String },
    performedBy: { type: String, required: true },
    performedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export default mongoose.model<ISellerApprovalHistory>('SellerApprovalHistory', SellerApprovalHistorySchema);
