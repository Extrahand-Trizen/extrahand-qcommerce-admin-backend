import mongoose, { Schema, Document, Types } from 'mongoose';
import { DOCUMENT_TYPES, DocumentType, DOCUMENT_VERIFICATION_STATUS, DocumentVerificationStatus } from '../types';

export interface ISellerDocument extends Document {
  sellerId: Types.ObjectId;
  onboardingId: Types.ObjectId;
  documentType: DocumentType;
  documentNumber?: string;
  fileUrl?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  verificationStatus: DocumentVerificationStatus;
  rejectionReason?: string;
  uploadedAt: Date;
  verifiedAt?: Date;
  verifiedBy?: string;
}

const SellerDocumentSchema = new Schema<ISellerDocument>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    onboardingId: { type: Schema.Types.ObjectId, ref: 'SellerOnboarding', required: true, index: true },
    documentType: { type: String, enum: DOCUMENT_TYPES, required: true },
    documentNumber: { type: String },
    fileUrl: { type: String },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    verificationStatus: { type: String, enum: DOCUMENT_VERIFICATION_STATUS, default: 'PENDING' },
    rejectionReason: { type: String },
    uploadedAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date },
    verifiedBy: { type: String },
  },
  { timestamps: false }
);

SellerDocumentSchema.index({ sellerId: 1, documentType: 1 });

export default mongoose.model<ISellerDocument>('SellerDocument', SellerDocumentSchema);
