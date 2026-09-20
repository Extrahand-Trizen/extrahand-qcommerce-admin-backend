import mongoose, { Schema, Document, Types } from 'mongoose';

export type CartReservationStatus = 'ACTIVE' | 'EXPIRED' | 'CONSUMED' | 'RELEASED';

export interface ICartReservation extends Document {
  userId: string;
  sellerId: Types.ObjectId;
  masterProductId: Types.ObjectId;
  listingId?: Types.ObjectId;
  productSlug: string;
  quantity: number;
  reservedAt: Date;
  expiresAt: Date;
  status: CartReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const CartReservationSchema = new Schema<ICartReservation>(
  {
    userId: { type: String, required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true, index: true },
    listingId: { type: Schema.Types.ObjectId, ref: 'SellerListing' },
    productSlug: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    reservedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'CONSUMED', 'RELEASED'],
      default: 'ACTIVE',
      index: true,
    },
  },
  { timestamps: true }
);

CartReservationSchema.index({ userId: 1, masterProductId: 1, status: 1 });
CartReservationSchema.index({ sellerId: 1, masterProductId: 1, status: 1 });
CartReservationSchema.index({ expiresAt: 1, status: 1 });

export default mongoose.model<ICartReservation>('CartReservation', CartReservationSchema);
