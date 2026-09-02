import mongoose, { Schema, Document, Types } from 'mongoose';

export const QC_ORDER_STATUS = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'CANCELLED',
  'FAILED',
] as const;
export type QcOrderStatus = (typeof QC_ORDER_STATUS)[number];

export const QC_PAYMENT_STATUS = ['PENDING', 'PAID', 'FAILED'] as const;
export type QcPaymentStatus = (typeof QC_PAYMENT_STATUS)[number];

export interface IQcOrderItem {
  productSlug: string;
  masterProductId: Types.ObjectId;
  name: string;
  unit: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  imageUrl?: string;
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
  orderNumber: string;
  status: QcOrderStatus;
  paymentStatus: QcPaymentStatus;
  items: IQcOrderItem[];
  address: IQcOrderAddress;
  deliveryInstructions: string[];
  partnerTipPaise: number;
  itemTotalPaise: number;
  deliveryFeePaise: number;
  handlingFeePaise: number;
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

const CustomerOrderSchema = new Schema<ICustomerOrder>(
  {
    userId: { type: String, required: true, index: true },
    orderNumber: { type: String, required: true, unique: true },
    status: { type: String, enum: QC_ORDER_STATUS, default: 'PENDING_PAYMENT' },
    paymentStatus: { type: String, enum: QC_PAYMENT_STATUS, default: 'PENDING' },
    items: { type: [QcOrderItemSchema], default: [] },
    address: { type: QcOrderAddressSchema, required: true },
    deliveryInstructions: { type: [String], default: [] },
    partnerTipPaise: { type: Number, default: 0, min: 0 },
    itemTotalPaise: { type: Number, required: true, min: 0 },
    deliveryFeePaise: { type: Number, required: true, min: 0 },
    handlingFeePaise: { type: Number, required: true, min: 0 },
    couponDiscountPaise: { type: Number, default: 0, min: 0 },
    amountPaise: { type: Number, required: true, min: 0 },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
  },
  { timestamps: true },
);

CustomerOrderSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<ICustomerOrder>('CustomerOrder', CustomerOrderSchema);
