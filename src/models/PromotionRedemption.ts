import mongoose, { Schema, Document, Types } from 'mongoose';
import { PromotionTrigger, PROMOTION_TRIGGER } from '../types';

/** One product's slice of a promotion redemption. */
export interface IPromotionRedemptionLine {
  masterProductId: Types.ObjectId;
  name: string;
  quantity: number;
  discountPaise: number;
}

/**
 * One row per (promotion, paid order). Written in QcOrderService.confirmPayment.
 * Drives per-customer limits, the real usage stats and the per-product
 * "how much did I give away" numbers on the seller offers overview.
 */
export interface IPromotionRedemption extends Document {
  promotionId: Types.ObjectId;
  sellerId: Types.ObjectId;
  code?: string;
  trigger: PromotionTrigger;
  userId: string;
  orderId: Types.ObjectId;
  orderNumber: string;
  /** Total discount from this promotion on this order (paise). */
  discountPaise: number;
  /** Per-product breakdown (PRODUCTS-scoped promotions). Empty for ORDER scope. */
  lines: IPromotionRedemptionLine[];
  createdAt: Date;
  updatedAt: Date;
}

const PromotionRedemptionLineSchema = new Schema<IPromotionRedemptionLine>(
  {
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    discountPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const PromotionRedemptionSchema = new Schema<IPromotionRedemption>(
  {
    promotionId: { type: Schema.Types.ObjectId, ref: 'Promotion', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    code: { type: String, uppercase: true, trim: true },
    trigger: { type: String, enum: PROMOTION_TRIGGER, required: true },
    userId: { type: String, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'CustomerOrder', required: true },
    orderNumber: { type: String, required: true },
    discountPaise: { type: Number, required: true, min: 0 },
    lines: { type: [PromotionRedemptionLineSchema], default: [] },
  },
  { timestamps: true }
);

// One redemption per promotion per order — makes confirmPayment idempotent.
PromotionRedemptionSchema.index({ promotionId: 1, orderId: 1 }, { unique: true });
PromotionRedemptionSchema.index({ sellerId: 1, createdAt: -1 });
PromotionRedemptionSchema.index({ promotionId: 1, userId: 1 });

export default mongoose.model<IPromotionRedemption>(
  'PromotionRedemption',
  PromotionRedemptionSchema
);
