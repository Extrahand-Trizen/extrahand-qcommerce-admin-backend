import mongoose, { Schema, Document, Types } from 'mongoose';
import {
  PROMOTION_TYPE,
  PromotionType,
  PROMOTION_STATE,
  PromotionState,
} from '../types';

/**
 * A seller-created discount code. Management only for now — actually applying a
 * code to a cart belongs to the Orders phase. `usedCount` stays 0 until then.
 */
export interface IPromotion extends Document {
  sellerId: Types.ObjectId;
  /** Uppercase, unique per seller. */
  code: string;
  description?: string;
  type: PromotionType;
  /** PERCENT: 1–100. FLAT: integer paise. */
  value: number;
  /** Minimum cart value (paise) for the code to apply. */
  minOrderPaise?: number;
  /** Cap on the discount amount (paise) — PERCENT codes only. */
  maxDiscountPaise?: number;
  /** Total redemptions allowed across all customers. */
  usageLimit?: number;
  /** Redemptions allowed per customer. */
  perCustomerLimit?: number;
  usedCount: number;
  totalDiscountGivenPaise: number;
  startsAt: Date;
  endsAt: Date;
  state: PromotionState;
  createdAt: Date;
  updatedAt: Date;
}

const PromotionSchema = new Schema<IPromotion>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
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

PromotionSchema.index({ sellerId: 1, code: 1 }, { unique: true });

export default mongoose.model<IPromotion>('Promotion', PromotionSchema);
