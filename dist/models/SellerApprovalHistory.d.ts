import mongoose, { Document, Types } from 'mongoose';
import { ApprovalAction } from '../types';
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
declare const _default: mongoose.Model<ISellerApprovalHistory, {}, {}, {}, mongoose.Document<unknown, {}, ISellerApprovalHistory, {}, {}> & ISellerApprovalHistory & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
