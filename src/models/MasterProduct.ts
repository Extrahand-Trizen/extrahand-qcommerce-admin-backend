import mongoose, { Schema, Document, Types } from 'mongoose';
import { ENTITY_STATUS, EntityStatus, ProductAttributeValue } from '../types';

export interface IMasterProduct extends Document {
  categoryId: Types.ObjectId;
  subcategoryId: Types.ObjectId;
  productTypeId: Types.ObjectId;
  name: string;
  slug: string;
  brand?: string;
  description?: string;
  sku: string;
  gtin?: string;
  /** Reference/default selling price in integer paise. Sellers inherit this when
   *  they add the product and may override it on their own listing. */
  sellingPricePaise: number;
  attributes: ProductAttributeValue[];
  complianceInfo?: string;
  status: EntityStatus;
  createdBy?: string;
  updatedBy?: string;
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

const MasterProductSchema = new Schema<IMasterProduct>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Subcategory', required: true, index: true },
    productTypeId: { type: Schema.Types.ObjectId, ref: 'ProductType', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    brand: { type: String, trim: true },
    description: { type: String },
    sku: { type: String, required: true, unique: true, trim: true },
    gtin: { type: String, trim: true, sparse: true },
    sellingPricePaise: { type: Number, required: true, min: 0 },
    attributes: [ProductAttributeValueSchema],
    complianceInfo: { type: String },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

MasterProductSchema.index({ name: 'text', brand: 'text', sku: 'text' });
MasterProductSchema.index({ categoryId: 1, status: 1 });
MasterProductSchema.index({ subcategoryId: 1, status: 1 });

export default mongoose.model<IMasterProduct>('MasterProduct', MasterProductSchema);
