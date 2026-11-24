import mongoose, { Schema, Document } from 'mongoose';
import { ENTITY_STATUS, EntityStatus } from '../types';

export interface IVertical extends Document {
  name: string;
  code: string;
  icon?: string;
  description?: string;
  displayOrder: number;
  status: EntityStatus;
  shopCategoryKey?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const VerticalSchema = new Schema<IVertical>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    icon: { type: String, default: '📦', trim: true },
    description: { type: String, trim: true },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    shopCategoryKey: { type: String, trim: true, lowercase: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

VerticalSchema.index({ code: 1, status: 1 });
VerticalSchema.index({ status: 1, displayOrder: 1 });

export default mongoose.model<IVertical>('Vertical', VerticalSchema);
