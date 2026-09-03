import mongoose, { Schema, Document, Types } from 'mongoose';
import { SUBMISSION_STATUS, SubmissionStatus, ProductAttributeValue } from '../types';

export interface IProductSubmission extends Document {
  sellerId: Types.ObjectId;
  submittedProductName: string;
  categoryId: Types.ObjectId;
  /** Optional — a shopkeeper only picks the top-level category; the admin
   *  assigns subcategory + product type + attributes during review. */
  subcategoryId?: Types.ObjectId;
  productTypeId?: Types.ObjectId;
  brand?: string;
  description?: string;
  requestedAttributes: ProductAttributeValue[];
  images: string[];
  /** Raw shopkeeper inputs from the minimal request form. */
  packOrSoldAs?: string;
  sellingPricePaise?: number;
  photoUrl?: string;
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
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Subcategory' },
    productTypeId: { type: Schema.Types.ObjectId, ref: 'ProductType' },
    brand: { type: String, trim: true },
    description: { type: String },
    requestedAttributes: [ProductAttributeValueSchema],
    images: [{ type: String }],
    packOrSoldAs: { type: String, trim: true },
    sellingPricePaise: { type: Number, min: 0 },
    photoUrl: { type: String },
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
