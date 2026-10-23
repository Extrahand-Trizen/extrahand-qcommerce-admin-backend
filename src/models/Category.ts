import mongoose, { Schema, Document, Types } from 'mongoose';
import { ENTITY_STATUS, EntityStatus } from '../types';

export type StoreVertical = 'KIRANA' | 'MEDICAL' | 'ALL';

export interface ICategory extends Document {
  name: string;
  slug: string;
  /** Short uppercase code (2-6 chars) used as the SKU prefix, e.g. "FRESH". */
  code: string;
  vertical: StoreVertical;
  description?: string;
  imageUrl?: string;
  displayOrder: number;
  status: EntityStatus;
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
      maxlength: 6,
    },
    vertical: {
      type: String,
      enum: ['KIRANA', 'MEDICAL', 'ALL'],
      default: 'KIRANA',
      index: true,
    },
    description: { type: String, trim: true },
    imageUrl: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

CategorySchema.index({ name: 1 }, { unique: true });
CategorySchema.index({ code: 1 }, { unique: true });

export default mongoose.model<ICategory>('Category', CategorySchema);
