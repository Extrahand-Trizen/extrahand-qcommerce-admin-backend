import mongoose, { Schema, Document, Types } from 'mongoose';
import {
  ENTITY_STATUS,
  EntityStatus,
  NutritionInformation,
  ProductAttributeValue,
  ProductInformation,
} from '../types';

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
   *  they add the product and may override it on their own listing. Defaults to
   *  0 so existing admin create flows keep working; set it in admin or on approve. */
  sellingPricePaise: number;
  attributes: ProductAttributeValue[];
  /** Regulatory/compliance notes — kept separate from Product Information. */
  complianceInfo?: string;
  /** Ingredients, manufacturer, storage, usage, nutrition, allergens — not catalogue attributes. */
  productInformation?: ProductInformation;
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

const NutritionInformationSchema = new Schema<NutritionInformation>(
  {
    servingSize: { type: String, trim: true },
    energy: { type: String, trim: true },
    protein: { type: String, trim: true },
    carbohydrates: { type: String, trim: true },
    totalFat: { type: String, trim: true },
    saturatedFat: { type: String, trim: true },
    sugar: { type: String, trim: true },
    sodium: { type: String, trim: true },
  },
  { _id: false }
);

const ProductInformationSchema = new Schema<ProductInformation>(
  {
    ingredients: { type: String, trim: true },
    manufacturer: { type: String, trim: true },
    healthBenefits: { type: String, trim: true },
    specialFeatures: { type: String, trim: true },
    storageInformation: { type: String, trim: true },
    usageInstructions: { type: String, trim: true },
    nutritionInformation: { type: NutritionInformationSchema },
    allergens: { type: String, trim: true },
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
    sellingPricePaise: { type: Number, default: 0, min: 0 },
    attributes: [ProductAttributeValueSchema],
    complianceInfo: { type: String },
    productInformation: { type: ProductInformationSchema },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

MasterProductSchema.index({ name: 'text', brand: 'text', sku: 'text' });
MasterProductSchema.index({ categoryId: 1, status: 1 });
MasterProductSchema.index({ subcategoryId: 1, status: 1 });
/** Storefront PLP/home sort */
MasterProductSchema.index({ status: 1, createdAt: -1 });
MasterProductSchema.index({ status: 1, subcategoryId: 1, createdAt: -1 });
MasterProductSchema.index({ status: 1, categoryId: 1, createdAt: -1 });
MasterProductSchema.index({ status: 1, productTypeId: 1, createdAt: -1 });
MasterProductSchema.index({ slug: 1, status: 1 });

export default mongoose.model<IMasterProduct>('MasterProduct', MasterProductSchema);
