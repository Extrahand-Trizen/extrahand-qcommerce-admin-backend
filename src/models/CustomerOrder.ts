import mongoose, { Schema, Document, Types } from 'mongoose';

export const QC_ORDER_STATUS = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
] as const;
export type QcOrderStatus = (typeof QC_ORDER_STATUS)[number];

export const QC_PAYMENT_STATUS = ['PENDING', 'PAID', 'FAILED'] as const;
export type QcPaymentStatus = (typeof QC_PAYMENT_STATUS)[number];

/**
 * Seller-driven fulfilment lifecycle, tracked separately from `status`
 * (payment/settlement) so the customer app's reading of `status` is untouched.
 * Set to PENDING_ACCEPT the moment payment is confirmed.
 */
export const QC_FULFILLMENT_STATUS = [
  'PENDING_ACCEPT',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'HANDED_OVER',
  'REJECTED',
  'CANCELLED',
] as const;
export type QcFulfillmentStatus = (typeof QC_FULFILLMENT_STATUS)[number];

export const QC_REJECT_REASON = [
  'ITEM_UNAVAILABLE',
  'TOO_BUSY',
  'CLOSING_SOON',
  'CANNOT_DELIVER_AREA',
  'OTHER',
  /** System-set only — the shop didn't accept before `acceptDeadline`. Never
   *  shown in the seller reject sheet. */
  'TIMEOUT',
] as const;
export type QcRejectReason = (typeof QC_REJECT_REASON)[number];

/** A refund issued against this order's payment (Track B timeout, later Track C/E). */
export const QC_REFUND_STATUS = ['PENDING', 'ISSUED', 'FAILED'] as const;
export type QcRefundStatus = (typeof QC_REFUND_STATUS)[number];

export interface IQcOrderRefund {
  amountPaise: number;
  /** Why the refund was issued: 'TIMEOUT' | 'ITEM_UNAVAILABLE' | 'CANCELLED' ... */
  reason: string;
  status: QcRefundStatus;
  razorpayRefundId?: string;
  at: Date;
  note?: string;
}

export interface IQcFulfillmentEvent {
  action: string;
  by: 'seller' | 'system' | 'customer';
  at: Date;
  meta?: Record<string, unknown>;
}

export interface IQcOrderItem {
  productSlug: string;
  masterProductId: Types.ObjectId;
  name: string;
  unit: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  imageUrl?: string;
  /** Pre-discount unit price when an automatic offer applied to this line. */
  mrpPaise?: number;
  /** Total saved on this line from an automatic offer (paise). */
  savingsPaise?: number;
  /** The AUTOMATIC promotion that discounted this line. */
  offerPromotionId?: Types.ObjectId;
  /** Track E prep checklist — the shopkeeper has collected/packed this line.
   *  Reset to false on start-preparing; all must be true to mark the order ready. */
  preparationChecked?: boolean;
}

export interface IQcOrderAddress {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  pinCode: string;
  coordinates?: [number, number];
  name?: string;
  phone?: string;
}

export interface ICustomerOrder extends Document {
  userId: string;
  sellerId?: Types.ObjectId;
  shopName?: string;
  shopCity?: string;
  orderNumber: string;
  status: QcOrderStatus;
  paymentStatus: QcPaymentStatus;
  /** Absent on orders created before the fulfilment feature; set to
   *  PENDING_ACCEPT when payment is confirmed. */
  fulfillmentStatus?: QcFulfillmentStatus;
  /** Track B — when PENDING_ACCEPT lapses into an auto-reject. Set at payment. */
  acceptDeadline?: Date;
  acceptedAt?: Date;
  /** Track E — when the shopkeeper hit "Start Preparing". */
  preparingStartedAt?: Date;
  /** The shopkeeper's ORIGINAL prep estimate at accept (minutes). Extensions
   *  don't change this — they add to `prepMinutesAdded`. */
  prepMinutes?: number;
  /** Track E — total extra minutes added via "Add time" while preparing. */
  prepMinutesAdded?: number;
  /** acceptedAt + prepMinutes + prepMinutesAdded. Recomputed on each extension. */
  readyBy?: Date;
  /** Track E — set when the order was marked ready. */
  readyAt?: Date;
  /** Track E — true if `readyAt` was after `readyBy` (prep-time SLA breach). */
  prepBreached?: boolean;
  rejectedReason?: QcRejectReason;
  rejectedNote?: string;
  /** 4-digit code the delivery partner presents at pickup. Seller-facing only. */
  handoverCode?: string;
  fulfillmentEvents: IQcFulfillmentEvent[];
  refunds: IQcOrderRefund[];
  items: IQcOrderItem[];
  address: IQcOrderAddress;
  deliveryInstructions: string[];
  partnerTipPaise: number;
  itemTotalPaise: number;
  deliveryFeePaise: number;
  handlingFeePaise: number;
  /** The discount-code the customer applied, if any (uppercase). */
  couponCode?: string;
  couponDiscountPaise: number;
  amountPaise: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const QcOrderItemSchema = new Schema<IQcOrderItem>(
  {
    productSlug: { type: String, required: true },
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true },
    name: { type: String, required: true },
    unit: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPricePaise: { type: Number, required: true, min: 0 },
    lineTotalPaise: { type: Number, required: true, min: 0 },
    imageUrl: { type: String },
    mrpPaise: { type: Number, min: 0 },
    savingsPaise: { type: Number, min: 0 },
    offerPromotionId: { type: Schema.Types.ObjectId, ref: 'Promotion' },
    preparationChecked: { type: Boolean, default: false },
  },
  { _id: false },
);

const QcOrderAddressSchema = new Schema<IQcOrderAddress>(
  {
    label: String,
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: String,
    pinCode: { type: String, required: true },
    coordinates: { type: [Number] },
    name: String,
    phone: String,
  },
  { _id: false },
);

const QcFulfillmentEventSchema = new Schema<IQcFulfillmentEvent>(
  {
    action: { type: String, required: true },
    by: { type: String, enum: ['seller', 'system', 'customer'], required: true },
    at: { type: Date, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const QcOrderRefundSchema = new Schema<IQcOrderRefund>(
  {
    amountPaise: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    status: { type: String, enum: QC_REFUND_STATUS, default: 'PENDING' },
    razorpayRefundId: { type: String },
    at: { type: Date, required: true },
    note: { type: String, trim: true },
  },
  { _id: false },
);

const CustomerOrderSchema = new Schema<ICustomerOrder>(
  {
    userId: { type: String, required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', index: true },
    shopName: { type: String, trim: true },
    shopCity: { type: String, trim: true },
    orderNumber: { type: String, required: true, unique: true },
    status: { type: String, enum: QC_ORDER_STATUS, default: 'PENDING_PAYMENT' },
    paymentStatus: { type: String, enum: QC_PAYMENT_STATUS, default: 'PENDING' },
    fulfillmentStatus: { type: String, enum: QC_FULFILLMENT_STATUS },
    acceptDeadline: { type: Date },
    acceptedAt: { type: Date },
    preparingStartedAt: { type: Date },
    prepMinutes: { type: Number, min: 1, max: 180 },
    prepMinutesAdded: { type: Number, default: 0, min: 0 },
    readyBy: { type: Date },
    readyAt: { type: Date },
    prepBreached: { type: Boolean },
    rejectedReason: { type: String, enum: QC_REJECT_REASON },
    rejectedNote: { type: String, trim: true },
    handoverCode: { type: String },
    fulfillmentEvents: { type: [QcFulfillmentEventSchema], default: [] },
    refunds: { type: [QcOrderRefundSchema], default: [] },
    items: { type: [QcOrderItemSchema], default: [] },
    address: { type: QcOrderAddressSchema, required: true },
    deliveryInstructions: { type: [String], default: [] },
    partnerTipPaise: { type: Number, default: 0, min: 0 },
    itemTotalPaise: { type: Number, required: true, min: 0 },
    deliveryFeePaise: { type: Number, required: true, min: 0 },
    handlingFeePaise: { type: Number, required: true, min: 0 },
    couponCode: { type: String, uppercase: true, trim: true },
    couponDiscountPaise: { type: Number, default: 0, min: 0 },
    amountPaise: { type: Number, required: true, min: 0 },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
  },
  { timestamps: true },
);

CustomerOrderSchema.index({ userId: 1, createdAt: -1 });
CustomerOrderSchema.index({ sellerId: 1, createdAt: -1 });
CustomerOrderSchema.index({ sellerId: 1, fulfillmentStatus: 1 });
// Track B — the accept-timeout sweep.
CustomerOrderSchema.index({ fulfillmentStatus: 1, acceptDeadline: 1 });

export default mongoose.model<ICustomerOrder>('CustomerOrder', CustomerOrderSchema);
