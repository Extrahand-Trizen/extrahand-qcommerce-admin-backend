import mongoose, { Schema, Document, Types } from 'mongoose';

export const QC_DELIVERY_SLOT_STATUS = ['OPEN', 'CLOSED'] as const;
export type QcDeliverySlotStatus = (typeof QC_DELIVERY_SLOT_STATUS)[number];

/**
 * Per-seller delivery window inventory for Scheduled Delivery.
 * Capacity = held (unpaid checkout) + booked (paid) must stay under `capacity`.
 */
export interface IQcDeliverySlot extends Document {
  sellerId: Types.ObjectId;
  /** IST calendar day YYYY-MM-DD */
  dateKey: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  heldCount: number;
  bookedCount: number;
  status: QcDeliverySlotStatus;
  groupKey: string;
  groupLabel: string;
  createdAt: Date;
  updatedAt: Date;
}

const QcDeliverySlotSchema = new Schema<IQcDeliverySlot>(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
      index: true,
    },
    dateKey: { type: String, required: true, index: true },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    capacity: { type: Number, required: true, min: 1 },
    heldCount: { type: Number, required: true, default: 0, min: 0 },
    bookedCount: { type: Number, required: true, default: 0, min: 0 },
    status: {
      type: String,
      enum: QC_DELIVERY_SLOT_STATUS,
      default: 'OPEN',
      index: true,
    },
    groupKey: { type: String, required: true, default: 'day' },
    groupLabel: { type: String, required: true, default: 'Available' },
  },
  { timestamps: true },
);

QcDeliverySlotSchema.index(
  { sellerId: 1, startAt: 1, endAt: 1 },
  { unique: true },
);
QcDeliverySlotSchema.index({ sellerId: 1, dateKey: 1, startAt: 1 });

export default mongoose.model<IQcDeliverySlot>('QcDeliverySlot', QcDeliverySlotSchema);
