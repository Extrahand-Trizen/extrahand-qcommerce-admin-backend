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
  /** Structured lifespan fields (e.g. lifespanValue: 7, lifespanUnit: 'Days') */
  lifespanValue?: number;
  lifespanUnit?: string;
  vertical?: 'KIRANA' | 'MEDICAL' | 'SEASONAL' | 'FOOD';
  isMedicalProduct?: boolean;
  isSeasonalProduct?: boolean;
  isFoodProduct?: boolean;
  dietaryTag?: 'VEG' | 'NON_VEG' | 'EGG';
  itemType?: 'GOODS' | 'SERVICES';
  cuisine?: string;
  servingSize?: string;
  servingUnit?: string;
  variants?: Array<{
    variantId: string;
    variantName: string;
    servingSize?: string;
    servingUnit?: string;
    pricePaise: number;
    mrpPaise?: number;
    availability?: boolean;
  }>;
  addonGroups?: Array<{
    groupId: string;
    groupName: string;
    selectionType: 'SINGLE' | 'MULTIPLE';
    minSelection: number;
    maxSelection: number;
    isMandatory: boolean;
    options: Array<{
      optionId: string;
      name: string;
      additionalPricePaise: number;
      availability?: boolean;
    }>;
  }>;
  foodInformation?: {
    ingredients?: string;
    keyIngredients?: string;
    allergens?: string[];
    spiceLevel?: string;
    preparationMethod?: string;
    preparationTimeMinutes?: number;
    storageInstructions?: string;
    flavour?: string;
    cutType?: string;
    freshness?: string;
    customMessageAvailable?: boolean;
    nutritionalInformation?: Record<string, any>;
  };
  availabilityDetails?: {
    dailyCapacity?: number;
    availableQuantity?: number;
    maxOrderQuantity?: number;
    availableFromTime?: string;
    availableUntilTime?: string;
    isAvailable?: boolean;
  };
  festival?: string;
  seasonalSubcategory?: string;
  seasonalDetails?: Record<string, any>;
  availableFrom?: Date;
  availableUntil?: Date;
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
    manufacturerAddress: { type: String, trim: true },
    healthBenefits: { type: String, trim: true },
    specialFeatures: { type: String, trim: true },
    storageInformation: { type: String, trim: true },
    usageInstructions: { type: String, trim: true },
    nutritionInformation: { type: NutritionInformationSchema },
    allergens: { type: String, trim: true },
    // Medical fields
    genericName: { type: String, trim: true },
    dosageForm: { type: String, trim: true },
    routeOfAdmin: { type: String, trim: true },
    strength: { type: String, trim: true },
    prescriptionCategory: { type: String, trim: true },
    sideEffects: { type: String, trim: true },
    indication: { type: String, trim: true },
    marketerName: { type: String, trim: true },
    countryOfOrigin: { type: String, trim: true },
    disclaimer: { type: String, trim: true },
    sterility: { type: String, trim: true },
    useType: { type: String, trim: true },
    licenceNumber: { type: String, trim: true },
    regulatoryInfo: { type: String, trim: true },
    coldChainRequired: { type: Boolean, default: false },
    prescriptionRequired: { type: Boolean, default: false },
    // Seasonal fields in product information
    festival: { type: String, trim: true },
    seasonalSubcategory: { type: String, trim: true },
    specifications: { type: Schema.Types.Mixed },
    complianceDetails: { type: Schema.Types.Mixed },
    customAttributes: [
      {
        label: { type: String, required: true, trim: true, maxlength: 80 },
        value: { type: String, required: true, trim: true, maxlength: 500 },
        _id: false,
      },
    ],
    manufacturerContactNumber: { type: String, trim: true },
    manufacturerEmail: { type: String, trim: true },
    importerDetails: { type: String, trim: true },
    packerDetails: { type: String, trim: true },
    certificationDetails: { type: String, trim: true },
    certificationNumber: { type: String, trim: true },
    certificationDocUrl: { type: String, trim: true },
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
    lifespanValue: { type: Number, min: 0 },
    lifespanUnit: { type: String, trim: true },
    vertical: {
      type: String,
      enum: ['KIRANA', 'MEDICAL', 'SEASONAL', 'FOOD'],
      default: 'KIRANA',
      index: true,
    },
    isMedicalProduct: {
      type: Boolean,
      default: false,
      index: true,
    },
    isSeasonalProduct: {
      type: Boolean,
      default: false,
      index: true,
    },
    isFoodProduct: {
      type: Boolean,
      default: false,
      index: true,
    },
    dietaryTag: {
      type: String,
      enum: ['VEG', 'NON_VEG', 'EGG'],
      index: true,
    },
    itemType: {
      type: String,
      enum: ['GOODS', 'SERVICES'],
      default: 'GOODS',
    },
    cuisine: {
      type: String,
      trim: true,
      index: true,
    },
    servingSize: {
      type: String,
      trim: true,
    },
    servingUnit: {
      type: String,
      trim: true,
    },
    variants: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    addonGroups: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    foodInformation: {
      type: Schema.Types.Mixed,
      default: null,
    },
    availabilityDetails: {
      type: Schema.Types.Mixed,
      default: null,
    },
    festival: {
      type: String,
      trim: true,
      index: true,
    },
    seasonalSubcategory: {
      type: String,
      trim: true,
      index: true,
    },
    seasonalDetails: {
      type: Schema.Types.Mixed,
    },
    availableFrom: {
      type: Date,
    },
    availableUntil: {
      type: Date,
      index: true,
    },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

MasterProductSchema.index({ name: 'text', brand: 'text', sku: 'text' });
MasterProductSchema.index({ name: 1, status: 1 });
MasterProductSchema.index({ brand: 1, status: 1 });
MasterProductSchema.index({ sku: 1, status: 1 });
MasterProductSchema.index({ categoryId: 1, status: 1 });
MasterProductSchema.index({ subcategoryId: 1, status: 1 });
/** Storefront PLP/home sort */
MasterProductSchema.index({ status: 1, createdAt: -1 });
MasterProductSchema.index({ status: 1, subcategoryId: 1, createdAt: -1 });
MasterProductSchema.index({ status: 1, categoryId: 1, createdAt: -1 });
MasterProductSchema.index({ status: 1, productTypeId: 1, createdAt: -1 });
MasterProductSchema.index({ slug: 1, status: 1 });

export default mongoose.model<IMasterProduct>('MasterProduct', MasterProductSchema);
