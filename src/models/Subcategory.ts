import mongoose, { Schema, Document, Types } from 'mongoose';
import { ENTITY_STATUS, EntityStatus } from '../types';
import { StoreVertical, STORE_VERTICALS } from './Category';

export interface ISubcategory extends Document {
  categoryId: Types.ObjectId;
  name: string;
  slug: string;
  vertical?: StoreVertical;
  description?: string;
  imageUrl?: string;
  displayOrder: number;
  status: EntityStatus;
  platformFeePercent?: number;
  gstPercent?: number;
  sacCode?: string;
  sacHeading?: string;
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
    vertical: {
      type: String,
      default: 'KIRANA',
      index: true,
    },
    description: { type: String, trim: true },
    imageUrl: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    platformFeePercent: { type: Number, min: 0, max: 100 },
    gstPercent: { type: Number, min: 0, max: 100, default: 18 },
    sacCode: { type: String, trim: true },
    sacHeading: { type: String, trim: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

SubcategorySchema.index({ categoryId: 1, name: 1 }, { unique: true });
SubcategorySchema.index({ slug: 1, status: 1 });
SubcategorySchema.index({ categoryId: 1, status: 1, displayOrder: 1 });
SubcategorySchema.index({ vertical: 1, status: 1 });
SubcategorySchema.index({ platformFeePercent: 1 });
SubcategorySchema.index({ updatedAt: -1 });
SubcategorySchema.index({ name: 'text', slug: 'text' });

export default mongoose.model<ISubcategory>('Subcategory', SubcategorySchema);
