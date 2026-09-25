import mongoose, { Schema, Document, Types } from 'mongoose';
import { ONBOARDING_STATUS, OnboardingStatus } from '../types';

export interface IPharmacistDetails {
  name?: string;
  registrationNumber?: string;
  registrationState?: string;
  certificateUri?: string;
}

export interface IOnboardingBankAccount {
  accountHolderName?: string;
  accountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  passbookUri?: string;
  passbookImageUrl?: string;
  verificationStatus?: string;
}

export interface ISellerOnboarding extends Document {
  sellerId: Types.ObjectId;
  fullName: string;
  mobileNumber: string;
  email?: string;
  shopName: string;
  shopType?: string;
  category?: string;
  subcategory?: string;
  subcategories?: string[];
  /** Public URL of the shop photo (mirrored from the SHOP_IMAGE SellerDocument on upload). */
  shopImageUrl?: string;
  shopMobileNumber?: string;
  shopEmail?: string;
  shopDescription?: string;
  openingHours?: string;
  latitude?: number;
  longitude?: number;
  geoSource?: string;
  address: string;
  streetRoad?: string;
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
  panVerificationStatus?: 'NOT_VERIFIED' | 'VERIFIED' | 'FAILED';
  panVerifiedAt?: Date;
  panVerifiedName?: string;
  gstin?: string;
  gstinVerificationStatus?: 'NOT_VERIFIED' | 'VERIFIED' | 'FAILED';
  gstinVerifiedAt?: Date;
  gstinVerifiedLegalName?: string;
  gstinVerifiedTradeName?: string;
  aadhaarNumber?: string;
  aadhaarVerificationStatus?: 'NOT_VERIFIED' | 'VERIFIED' | 'FAILED';
  aadhaarVerifiedAt?: Date;
  fssaiNumber?: string;
  pharmacistDetails?: IPharmacistDetails;
  bankAccount?: IOnboardingBankAccount;
  status: OnboardingStatus;
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  adminComment?: string;
  lastCorrectionNote?: string;
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
    category: { type: String, trim: true },
    subcategory: { type: String, trim: true },
    subcategories: { type: [String], default: [] },
    shopImageUrl: { type: String },
    shopMobileNumber: { type: String },
    shopEmail: { type: String, lowercase: true, trim: true },
    shopDescription: { type: String },
    openingHours: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },
    geoSource: { type: String, trim: true },
    address: { type: String, required: true },
    streetRoad: { type: String, trim: true },
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
    panVerificationStatus: {
      type: String,
      enum: ['NOT_VERIFIED', 'VERIFIED', 'FAILED'],
      default: 'NOT_VERIFIED',
    },
    panVerifiedAt: { type: Date },
    panVerifiedName: { type: String },
    gstin: { type: String },
    gstinVerificationStatus: {
      type: String,
      enum: ['NOT_VERIFIED', 'VERIFIED', 'FAILED'],
      default: 'NOT_VERIFIED',
    },
    gstinVerifiedAt: { type: Date },
    gstinVerifiedLegalName: { type: String },
    gstinVerifiedTradeName: { type: String },
    aadhaarNumber: { type: String, trim: true },
    aadhaarVerificationStatus: {
      type: String,
      enum: ['NOT_VERIFIED', 'VERIFIED', 'FAILED'],
      default: 'NOT_VERIFIED',
    },
    aadhaarVerifiedAt: { type: Date },
    fssaiNumber: { type: String },
    pharmacistDetails: {
      name: { type: String, trim: true },
      registrationNumber: { type: String, trim: true },
      registrationState: { type: String, trim: true },
      certificateUri: { type: String },
    },
    bankAccount: {
      accountHolderName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      ifscCode: { type: String, trim: true },
      bankName: { type: String, trim: true },
      passbookUri: { type: String },
      passbookImageUrl: { type: String },
      verificationStatus: { type: String, default: 'NOT_VERIFIED' },
    },
    status: { type: String, enum: ONBOARDING_STATUS, default: 'DRAFT', index: true },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
    adminComment: { type: String },
    lastCorrectionNote: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<ISellerOnboarding>('SellerOnboarding', SellerOnboardingSchema);
