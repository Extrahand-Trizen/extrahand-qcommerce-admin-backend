import mongoose, { Schema, Document, Types } from 'mongoose';
import {
  LISTING_STATUS,
  ListingStatus,
  AVAILABILITY,
  Availability,
  LISTING_REVIEW_STATUS,
  ListingReviewStatus,
} from '../types';

export interface ISellerListing extends Document {
  sellerId: Types.ObjectId;
  masterProductId: Types.ObjectId;
  sellerSku?: string;
  /** Seller's selling price in integer paise. */
  sellingPricePaise: number;
  /** Optional strike-through / compare-at price in integer paise. */
  compareAtPricePaise?: number;
  status: ListingStatus;
  availability: Availability;
  /** APPROVED for master-linked listings; PENDING_REVIEW while a requested
   *  product is still being reviewed by an admin. */
  reviewStatus: ListingReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

const SellerListingSchema = new Schema<ISellerListing>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true, index: true },
    sellerSku: { type: String, trim: true },
    sellingPricePaise: { type: Number, required: true, min: 0 },
    compareAtPricePaise: { type: Number, min: 0 },
    status: { type: String, enum: LISTING_STATUS, default: 'ACTIVE' },
    availability: { type: String, enum: AVAILABILITY, default: 'AVAILABLE' },
    reviewStatus: { type: String, enum: LISTING_REVIEW_STATUS, default: 'APPROVED' },
  },
  { timestamps: true }
);

SellerListingSchema.index({ sellerId: 1, masterProductId: 1 }, { unique: true });
SellerListingSchema.index({ sellerId: 1, status: 1 });
/** Storefront: probe/join listed products by masterProductId */
SellerListingSchema.index({ masterProductId: 1, status: 1, reviewStatus: 1 });
/** Storefront: preferred-seller price lookup */
SellerListingSchema.index({ sellerId: 1, masterProductId: 1, status: 1, reviewStatus: 1 });
/** Storefront: auto seller resolution + best-price aggregation */
SellerListingSchema.index({ status: 1, reviewStatus: 1, sellerId: 1 });
SellerListingSchema.index({ status: 1, reviewStatus: 1, masterProductId: 1, sellingPricePaise: 1, availability: 1 });

export default mongoose.model<ISellerListing>('SellerListing', SellerListingSchema);
