import mongoose, { Schema, Document, Types } from 'mongoose';
import { SUBMISSION_STATUS, SubmissionStatus, ProductAttributeValue } from '../types';

export interface IProductSubmission extends Document {
  sellerId: Types.ObjectId;
  submittedProductName: string;
  isOtherProduct?: boolean;
  sku?: string;
  lowStockThreshold?: number;
  categoryId?: Types.ObjectId;
  customCategoryName?: string;
  /** Optional — a shopkeeper only picks the top-level category; the admin
   *  assigns subcategory + product type + attributes during review. */
  subcategoryId?: Types.ObjectId;
  customSubcategoryName?: string;
  productTypeId?: Types.ObjectId;
  customProductTypeName?: string;
  brand?: string;
  description?: string;
  requestedAttributes: ProductAttributeValue[];
  images: string[];
  /** Raw shopkeeper inputs from the minimal request form. */
  packOrSoldAs?: string;
  sellingPricePaise?: number;
  quantity?: number;
  lifespanValue?: number;
  lifespanUnit?: string;
  photoUrl?: string;
  frontImageUrl?: string;
  ingredientsImageUrl?: string;
  manufacturerName?: string;
  manufacturerAddress?: string;
  submissionNote?: string;
  status: SubmissionStatus;
  adminComment?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  mappedMasterProductId?: Types.ObjectId;
  isMasterCatalogueProduct?: boolean;

  /** Medical / Pharmaceutical Specific Fields */
  isMedicalProduct?: boolean;
  productType?: string;
  medicalCategory?: string;
  medicalSubcategory?: string;
  genericName?: string;
  dosageForm?: string;
  routeOfAdmin?: string;
  strength?: string;
  strengthUnit?: string;
  packSize?: string;
  packagingType?: string;
  netContent?: string;
  releaseType?: string;
  productForm?: string;
  indication?: string;
  directionsForUse?: string;
  keyBenefits?: string;
  keyIngredients?: string;
  safetyInfo?: string;
  sideEffects?: string;
  allergenInfo?: string;
  storageCondition?: string;
  disclaimer?: string;
  sterility?: string;
  useType?: string;
  marketerName?: string;
  countryOfOrigin?: string;
  licenceNumber?: string;
  prescriptionCategory?: string;
  regulatoryInfo?: string;
  mrpPaise?: number;
  unitOfSale?: string;
  batchNumber?: string;
  mfgDate?: string;
  expiryDate?: string;
  rackLocation?: string;
  coldChainRequired?: boolean;
  prescriptionRequired?: boolean;
  prescriptionDocUrl?: string;
  additionalNotes?: string;

  /** Seasonal / Festival Specific Fields */
  isSeasonalProduct?: boolean;
  festival?: string;
  seasonalSubcategory?: string;
  specifications?: Record<string, any>;
  manufacturerDetails?: Record<string, any>;
  complianceDetails?: Record<string, any>;
  availableFrom?: Date | string;
  availableUntil?: Date | string;
  minOrderQuantity?: number;
  maxOrderQuantity?: number;
  certificationDocUrl?: string;
  customAttributes?: Array<{ label: string; value: string }>;

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

const ProductSubmissionSchema = new Schema<IProductSubmission>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    submittedProductName: { type: String, required: true, trim: true },
    isOtherProduct: { type: Boolean, default: false, index: true },
    sku: { type: String, trim: true, maxlength: 120 },
    lowStockThreshold: { type: Number, min: 0 },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: function (this: IProductSubmission) {
        return !this.isOtherProduct;
      },
    },
    customCategoryName: { type: String, trim: true, maxlength: 120 },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Subcategory' },
    customSubcategoryName: { type: String, trim: true, maxlength: 120 },
    productTypeId: { type: Schema.Types.ObjectId, ref: 'ProductType' },
    customProductTypeName: { type: String, trim: true, maxlength: 120 },
    brand: { type: String, trim: true },
    description: { type: String },
    requestedAttributes: [ProductAttributeValueSchema],
    images: [{ type: String }],
    packOrSoldAs: { type: String, trim: true },
    sellingPricePaise: { type: Number, min: 0 },
    quantity: { type: Number, min: 0 },
    lifespanValue: { type: Number, min: 0 },
    lifespanUnit: { type: String, trim: true },
    photoUrl: { type: String },
    frontImageUrl: { type: String },
    ingredientsImageUrl: { type: String },
    manufacturerName: { type: String, trim: true },
    manufacturerAddress: { type: String, trim: true },
    submissionNote: { type: String },
    status: { type: String, enum: SUBMISSION_STATUS, default: 'PENDING', index: true },
    adminComment: { type: String },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    mappedMasterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct' },
    isMasterCatalogueProduct: { type: Boolean, default: false, index: true },

    /** Medical / Pharmaceutical Specific Fields */
    isMedicalProduct: { type: Boolean, default: false, index: true },
    productType: { type: String, trim: true },
    medicalCategory: { type: String, trim: true },
    medicalSubcategory: { type: String, trim: true },
    genericName: { type: String, trim: true, index: true },
    dosageForm: { type: String, trim: true },
    routeOfAdmin: { type: String, trim: true },
    strength: { type: String, trim: true },
    strengthUnit: { type: String, trim: true },
    packSize: { type: String, trim: true },
    packagingType: { type: String, trim: true },
    netContent: { type: String, trim: true },
    releaseType: { type: String, trim: true },
    productForm: { type: String, trim: true },
    indication: { type: String, trim: true },
    directionsForUse: { type: String, trim: true },
    keyBenefits: { type: String, trim: true },
    keyIngredients: { type: String, trim: true },
    safetyInfo: { type: String, trim: true },
    sideEffects: { type: String, trim: true },
    allergenInfo: { type: String, trim: true },
    storageCondition: { type: String, trim: true },
    disclaimer: { type: String, trim: true },
    sterility: { type: String, trim: true },
    useType: { type: String, trim: true },
    marketerName: { type: String, trim: true },
    countryOfOrigin: { type: String, trim: true },
    licenceNumber: { type: String, trim: true },
    prescriptionCategory: { type: String, trim: true },
    regulatoryInfo: { type: String, trim: true },
    mrpPaise: { type: Number, min: 0 },
    unitOfSale: { type: String, trim: true },
    batchNumber: { type: String, trim: true },
    mfgDate: { type: String, trim: true },
    expiryDate: { type: String, trim: true },
    rackLocation: { type: String, trim: true },
    coldChainRequired: { type: Boolean, default: false },
    prescriptionRequired: { type: Boolean, default: false },
    prescriptionDocUrl: { type: String, trim: true },
    additionalNotes: { type: String, trim: true },

    /** Seasonal / Festival Specific Fields */
    isSeasonalProduct: { type: Boolean, default: false, index: true },
    festival: { type: String, trim: true, index: true },
    seasonalSubcategory: { type: String, trim: true, index: true },
    specifications: { type: Schema.Types.Mixed },
    manufacturerDetails: { type: Schema.Types.Mixed },
    complianceDetails: { type: Schema.Types.Mixed },
    availableFrom: { type: Date },
    availableUntil: { type: Date },
    minOrderQuantity: { type: Number, min: 1 },
    maxOrderQuantity: { type: Number, min: 1 },
    certificationDocUrl: { type: String, trim: true },
    customAttributes: [{ label: { type: String, trim: true }, value: { type: String, trim: true }, _id: false }],
  },
  { timestamps: true }
);

export default mongoose.model<IProductSubmission>('ProductSubmission', ProductSubmissionSchema);
