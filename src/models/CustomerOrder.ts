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
] as const;
export type QcRejectReason = (typeof QC_REJECT_REASON)[number];

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
  acceptedAt?: Date;
  prepMinutes?: number;
  readyBy?: Date;
  rejectedReason?: QcRejectReason;
  rejectedNote?: string;
  /** 4-digit code the delivery partner presents at pickup. Seller-facing only. */
  handoverCode?: string;
  fulfillmentEvents: IQcFulfillmentEvent[];
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
    acceptedAt: { type: Date },
    prepMinutes: { type: Number, min: 1, max: 180 },
    readyBy: { type: Date },
    rejectedReason: { type: String, enum: QC_REJECT_REASON },
    rejectedNote: { type: String, trim: true },
    handoverCode: { type: String },
    fulfillmentEvents: { type: [QcFulfillmentEventSchema], default: [] },
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

export default mongoose.model<ICustomerOrder>('CustomerOrder', CustomerOrderSchema);
