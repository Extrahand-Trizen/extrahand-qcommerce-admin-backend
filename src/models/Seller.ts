import mongoose, { Schema, Document } from 'mongoose';
import { SELLER_STATUS, SellerStatus, ONBOARDING_STATUS, OnboardingStatus } from '../types';

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

const SellerSchema = new Schema<ISeller>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, required: true, trim: true },
    mobileNumber: { type: String, required: true, index: true },
    email: { type: String, lowercase: true, trim: true },
    status: { type: String, enum: SELLER_STATUS, default: 'PENDING', index: true },
    onboardingStatus: { type: String, enum: ONBOARDING_STATUS, default: 'DRAFT', index: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<ISeller>('Seller', SellerSchema);
