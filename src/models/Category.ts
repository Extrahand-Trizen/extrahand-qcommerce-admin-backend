import mongoose, { Schema, Document, Types } from 'mongoose';
import { ENTITY_STATUS, EntityStatus } from '../types';

export interface ICategory extends Document {
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

const CategorySchema = new Schema<ICategory>(
  {
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

CategorySchema.index({ name: 1 }, { unique: true });

export default mongoose.model<ICategory>('Category', CategorySchema);
