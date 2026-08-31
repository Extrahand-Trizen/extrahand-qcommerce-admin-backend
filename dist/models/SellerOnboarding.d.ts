import mongoose, { Document, Types } from 'mongoose';
import { OnboardingStatus } from '../types';
export interface ISellerOnboarding extends Document {
    sellerId: Types.ObjectId;
    fullName: string;
    mobileNumber: string;
    email?: string;
    shopName: string;
    shopType: string;
    shopMobileNumber?: string;
    shopEmail?: string;
    shopDescription?: string;
    latitude?: number;
    longitude?: number;
    address: string;
    area?: string;
    locality?: string;
    city: string;
    district?: string;
    state: string;
    pincode: string;
    landmark?: string;
    businessType?: string;
    pan?: string;
    gstin?: string;
    fssaiNumber?: string;
    status: OnboardingStatus;
    submittedAt?: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    adminComment?: string;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<ISellerOnboarding, {}, {}, {}, mongoose.Document<unknown, {}, ISellerOnboarding, {}, {}> & ISellerOnboarding & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
