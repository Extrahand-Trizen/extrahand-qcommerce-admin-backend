import mongoose, { Schema, Document, Types } from 'mongoose';
import { ENTITY_STATUS, EntityStatus } from '../types';

export interface ISubcategory extends Document {
  categoryId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  displayOrder: number;
  status: EntityStatus;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SubcategorySchema = new Schema<ISubcategory>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    imageUrl: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

SubcategorySchema.index({ categoryId: 1, name: 1 }, { unique: true });
SubcategorySchema.index({ slug: 1, status: 1 });

export default mongoose.model<ISubcategory>('Subcategory', SubcategorySchema);
