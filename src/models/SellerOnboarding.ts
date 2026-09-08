import mongoose, { Schema, Document, Types } from 'mongoose';
import { ONBOARDING_STATUS, OnboardingStatus } from '../types';

export interface ISellerOnboarding extends Document {
  sellerId: Types.ObjectId;
  fullName: string;
  mobileNumber: string;
  email?: string;
  shopName: string;
  shopType?: string;
  /** Public URL of the shop photo (mirrored from the SHOP_IMAGE SellerDocument on upload). */
  shopImageUrl?: string;
  shopMobileNumber?: string;
  shopEmail?: string;
  shopDescription?: string;
  latitude?: number;
  longitude?: number;
  address: string;
  /** Full one-line address from the map provider (place search / reverse geocode). */
  formattedAddress?: string;
  area?: string;
  locality?: string;
  city: string;
  district?: string;
  state: string;
  country?: string;
  pincode: string;
  landmark?: string;
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

const SellerOnboardingSchema = new Schema<ISellerOnboarding>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, unique: true, index: true },
    fullName: { type: String, required: true, trim: true },
    mobileNumber: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    shopName: { type: String, required: true, trim: true },
    shopType: { type: String, trim: true, default: 'Other' },
    shopImageUrl: { type: String },
    shopMobileNumber: { type: String },
    shopEmail: { type: String, lowercase: true, trim: true },
    shopDescription: { type: String },
    latitude: { type: Number },
    longitude: { type: Number },
    address: { type: String, required: true },
    formattedAddress: { type: String },
    area: { type: String },
    locality: { type: String },
    city: { type: String, required: true, index: true },
    district: { type: String },
    state: { type: String, required: true },
    country: { type: String },
    pincode: { type: String, required: true },
    landmark: { type: String },
    pan: { type: String },
    gstin: { type: String },
    fssaiNumber: { type: String },
    status: { type: String, enum: ONBOARDING_STATUS, default: 'DRAFT', index: true },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
    adminComment: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<ISellerOnboarding>('SellerOnboarding', SellerOnboardingSchema);
