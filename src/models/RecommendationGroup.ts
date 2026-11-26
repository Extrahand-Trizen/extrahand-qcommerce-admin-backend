import mongoose, { Schema, Document, Types } from 'mongoose';
import { ENTITY_STATUS, EntityStatus } from '../types';

export enum GroupMode {
  CATEGORY_DYNAMIC = 'CATEGORY_DYNAMIC',
  MANUAL_CURATED = 'MANUAL_CURATED',
}

export interface IRecommendationGroup extends Document {
  name: string;
  code: string;
  description: string;
  vertical: string;
  mode: GroupMode;
  sourceCategoryId?: Types.ObjectId;
  sourceSubcategoryId?: Types.ObjectId;
  includedProductIds: Types.ObjectId[];
  excludedProductIds: Types.ObjectId[];
  badgeText?: string;
  displayOrder: number;
  status: EntityStatus;
  matchingOnboardingSubcategories?: string[];
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RecommendationGroupSchema = new Schema<IRecommendationGroup>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, required: true, trim: true },
    vertical: { type: String, required: true, uppercase: true, index: true },
    mode: {
      type: String,
      enum: Object.values(GroupMode),
      default: GroupMode.CATEGORY_DYNAMIC,
    },
    sourceCategoryId: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    sourceSubcategoryId: { type: Schema.Types.ObjectId, ref: 'Subcategory' },
    includedProductIds: [{ type: Schema.Types.ObjectId, ref: 'MasterProduct' }],
    excludedProductIds: [{ type: Schema.Types.ObjectId, ref: 'MasterProduct' }],
    badgeText: { type: String, trim: true },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE', index: true },
    matchingOnboardingSubcategories: [{ type: String }],
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

RecommendationGroupSchema.index({ vertical: 1, status: 1, displayOrder: 1 });

export default mongoose.model<IRecommendationGroup>('RecommendationGroup', RecommendationGroupSchema);
