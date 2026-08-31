import mongoose, { Schema, Document, Types } from 'mongoose';
import { ATTRIBUTE_TYPES, AttributeType } from '../types';

export interface IAttributeOption {
  label: string;
  value: string;
  displayOrder: number;
  isActive: boolean;
}

export interface IAttribute extends Document {
  name: string;
  key: string;
  type: AttributeType;
  description?: string;
  options: IAttributeOption[];
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AttributeOptionSchema = new Schema<IAttributeOption>(
  {
    label: { type: String, required: true },
    value: { type: String, required: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const AttributeSchema = new Schema<IAttribute>(
  {
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    type: { type: String, enum: ATTRIBUTE_TYPES, required: true },
    description: { type: String, trim: true },
    options: [AttributeOptionSchema],
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IAttribute>('Attribute', AttributeSchema);
