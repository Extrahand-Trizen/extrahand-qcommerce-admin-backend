import mongoose, { Schema, Document, Types } from 'mongoose';
import { LISTING_STATUS, ListingStatus, AVAILABILITY, Availability } from '../types';

export interface ISellerListing extends Document {
  sellerId: Types.ObjectId;
  masterProductId: Types.ObjectId;
  sellerSku?: string;
  sellingPrice: number;
  compareAtPrice?: number;
  status: ListingStatus;
  availability: Availability;
  createdAt: Date;
  updatedAt: Date;
}

const SellerListingSchema = new Schema<ISellerListing>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true, index: true },
    sellerSku: { type: String, trim: true },
    sellingPrice: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, min: 0 },
    status: { type: String, enum: LISTING_STATUS, default: 'ACTIVE' },
    availability: { type: String, enum: AVAILABILITY, default: 'AVAILABLE' },
  },
  { timestamps: true }
);

SellerListingSchema.index({ sellerId: 1, masterProductId: 1 }, { unique: true });

export default mongoose.model<ISellerListing>('SellerListing', SellerListingSchema);
