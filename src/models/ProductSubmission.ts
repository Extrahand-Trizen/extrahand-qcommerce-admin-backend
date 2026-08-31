import mongoose, { Schema, Document, Types } from 'mongoose';
import { SUBMISSION_STATUS, SubmissionStatus, ProductAttributeValue } from '../types';

export interface IProductSubmission extends Document {
  sellerId: Types.ObjectId;
  submittedProductName: string;
  categoryId: Types.ObjectId;
  subcategoryId: Types.ObjectId;
  productTypeId: Types.ObjectId;
  brand?: string;
  description?: string;
  requestedAttributes: ProductAttributeValue[];
  images: string[];
  submissionNote?: string;
  status: SubmissionStatus;
  adminComment?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  mappedMasterProductId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProductAttributeValueSchema = new Schema(
  {
    attributeId: { type: Schema.Types.ObjectId, ref: 'Attribute', required: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

const ProductSubmissionSchema = new Schema<IProductSubmission>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    submittedProductName: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Subcategory', required: true },
    productTypeId: { type: Schema.Types.ObjectId, ref: 'ProductType', required: true },
    brand: { type: String, trim: true },
    description: { type: String },
    requestedAttributes: [ProductAttributeValueSchema],
    images: [{ type: String }],
    submissionNote: { type: String },
    status: { type: String, enum: SUBMISSION_STATUS, default: 'PENDING', index: true },
    adminComment: { type: String },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    mappedMasterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct' },
  },
  { timestamps: true }
);

export default mongoose.model<IProductSubmission>('ProductSubmission', ProductSubmissionSchema);
