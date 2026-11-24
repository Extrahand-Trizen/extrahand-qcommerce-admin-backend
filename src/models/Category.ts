import mongoose, { Schema, Document, Types } from 'mongoose';
import { ENTITY_STATUS, EntityStatus } from '../types';

export const STORE_VERTICALS = [
  'KIRANA',
  'MEDICAL',
  'FOOD',
  'SEASONAL',
  'FRESH_PRODUCE',
  'MEAT_SEAFOOD',
  'FASHION',
  'FOOTWEAR',
  'ELECTRONICS',
  'BEAUTY',
  'JEWELLERY',
  'HOME_LIVING',
  'OTHER',
  'ALL',
] as const;

export type StoreVertical = string;

export interface ICategory extends Document {
  name: string;
  slug: string;
  /** Short uppercase code (2-8 chars) used as the SKU prefix, e.g. "FRESH". */
  code: string;
  vertical: StoreVertical;
  festival?: string;
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

const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 2,
      maxlength: 8,
    },
    vertical: {
      type: String,
      default: 'KIRANA',
      index: true,
    },
    festival: {
      type: String,
      trim: true,
      index: true,
      required: function (this: ICategory) {
        return this.vertical === 'SEASONAL';
      },
    },
    description: { type: String, trim: true },
    imageUrl: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    platformFeePercent: { type: Number, min: 0, max: 100 },
    gstPercent: { type: Number, min: 0, max: 100, default: 18 },
    sacCode: { type: String, trim: true, default: '998313' },
    sacHeading: { type: String, trim: true, default: 'Marketplace Facilitation & Platform Commission Fee' },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

CategorySchema.index({ name: 1 }, { unique: true });
CategorySchema.index({ vertical: 1, status: 1, displayOrder: 1 });
CategorySchema.index({ displayOrder: 1 });
CategorySchema.index({ platformFeePercent: 1 });
CategorySchema.index({ updatedAt: -1 });
CategorySchema.index({ name: 'text', slug: 'text' });

export default mongoose.model<ICategory>('Category', CategorySchema);
