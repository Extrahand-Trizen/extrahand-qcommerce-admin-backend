import mongoose, { Schema, Document, Types } from 'mongoose';
import { ENTITY_STATUS, EntityStatus } from '../types';

export interface IProductType extends Document {
  categoryId: Types.ObjectId;
  subcategoryId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  displayOrder: number;
  status: EntityStatus;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProductTypeSchema = new Schema<IProductType>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Subcategory', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

ProductTypeSchema.index({ subcategoryId: 1, name: 1 }, { unique: true });

export default mongoose.model<IProductType>('ProductType', ProductTypeSchema);
