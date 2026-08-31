import mongoose, { Document } from 'mongoose';
import { SellerStatus, OnboardingStatus } from '../types';
export interface ISeller extends Document {
    userId: string;
    fullName: string;
    mobileNumber: string;
    email?: string;
    status: SellerStatus;
    onboardingStatus: OnboardingStatus;
    lastLoginAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<ISeller, {}, {}, {}, mongoose.Document<unknown, {}, ISeller, {}, {}> & ISeller & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
