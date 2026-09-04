import mongoose, { Schema, Document, Types } from 'mongoose';
import {
  PROMOTION_TYPE,
  PromotionType,
  PROMOTION_STATE,
  PromotionState,
  PROMOTION_TRIGGER,
  PromotionTrigger,
  PROMOTION_APPLIES_TO,
  PromotionAppliesTo,
} from '../types';

/** Display snapshot of a product an offer/coupon is scoped to. Refreshed on
 *  every write so the seller list, the offers overview and the customer app can
 *  render "20% off Saffron" without a join. */
export interface IPromotionProductSnapshot {
  masterProductId: Types.ObjectId;
  name: string;
  slug: string;
}

/**
 * A seller-created discount. Two flavours, one model:
 *  - trigger CODE      → customer types `code` at checkout.
 *  - trigger AUTOMATIC → discounted price shown on the storefront, applied with
 *                        no code. AUTOMATIC always implies appliesTo PRODUCTS.
 */
export interface IPromotion extends Document {
  sellerId: Types.ObjectId;
  trigger: PromotionTrigger;
  /** Uppercase, unique per seller. Present only for CODE promotions. */
  code?: string;
  description?: string;
  appliesTo: PromotionAppliesTo;
  /** Non-empty when appliesTo === 'PRODUCTS'. */
  productMasterIds: Types.ObjectId[];
  productSnapshots: IPromotionProductSnapshot[];
  type: PromotionType;
  /** PERCENT: 1–100. FLAT: integer paise. */
  value: number;
  /** Minimum cart value (paise) for the code to apply. CODE only. */
  minOrderPaise?: number;
  /** Cap on the discount amount (paise) — PERCENT codes only. */
  maxDiscountPaise?: number;
  /** Total redemptions allowed across all customers. CODE only. */
  usageLimit?: number;
  /** Redemptions allowed per customer. CODE only. */
  perCustomerLimit?: number;
  usedCount: number;
  totalDiscountGivenPaise: number;
  startsAt: Date;
  endsAt: Date;
  state: PromotionState;
  createdAt: Date;
  updatedAt: Date;
}

const PromotionProductSnapshotSchema = new Schema<IPromotionProductSnapshot>(
  {
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
  },
  { _id: false }
);

const PromotionSchema = new Schema<IPromotion>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    trigger: { type: String, enum: PROMOTION_TRIGGER, default: 'CODE', index: true },
    code: { type: String, uppercase: true, trim: true },
    description: { type: String, trim: true },
    appliesTo: { type: String, enum: PROMOTION_APPLIES_TO, default: 'ORDER' },
    productMasterIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'MasterProduct' }],
      default: [],
    },
    productSnapshots: { type: [PromotionProductSnapshotSchema], default: [] },
    type: { type: String, enum: PROMOTION_TYPE, required: true },
    value: { type: Number, required: true, min: 1 },
    minOrderPaise: { type: Number, min: 0 },
    maxDiscountPaise: { type: Number, min: 0 },
    usageLimit: { type: Number, min: 1 },
    perCustomerLimit: { type: Number, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    totalDiscountGivenPaise: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    state: { type: String, enum: PROMOTION_STATE, default: 'ACTIVE', index: true },
  },
  { timestamps: true }
);

// Codes are unique per seller — but only among promotions that actually have one
// (AUTOMATIC offers have no code, so they must be excluded from the constraint).
PromotionSchema.index(
  { sellerId: 1, code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: 'string' } } }
);
PromotionSchema.index({ sellerId: 1, productMasterIds: 1, state: 1 });
PromotionSchema.index({ trigger: 1, state: 1, startsAt: 1, endsAt: 1 });

export default mongoose.model<IPromotion>('Promotion', PromotionSchema);
