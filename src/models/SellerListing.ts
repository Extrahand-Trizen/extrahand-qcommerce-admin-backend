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
  /** Physical stock for this specific shop */
  stock: number;
  /** Reserved stock held by pending orders */
  reserved: number;
  /** Available stock (computed as Math.max(0, stock - reserved)) */
  available: number;
  /** Approved unit / pack size for this listing */
  unit?: string | null;
  /** Approved listing-level description override */
  customDescription?: string | null;
  /** Approved listing-level seller notes */
  customNotes?: string | null;
  /** Approved listing-level product attributes */
  customAttributes?: Array<{ attributeId: Types.ObjectId | string; value: any }> | null;
  /** Approved listing-level product information details */
  customProductInformation?: Record<string, any> | null;
  /** Pending selling price in integer paise awaiting admin approval */
  pendingSellingPricePaise?: number | null;
  /** Pending unit / pack size awaiting admin approval */
  pendingUnit?: string | null;
  /** Pending product description awaiting admin approval */
  pendingDescription?: string | null;
  /** Pending seller notes awaiting admin approval */
  pendingNotes?: string | null;
  /** Pending attributes awaiting admin approval */
  pendingAttributes?: Array<{ attributeId: Types.ObjectId | string; value: any }> | null;
  /** Pending product information details awaiting admin approval */
  pendingProductInformation?: Record<string, any> | null;
  /** Timestamp when price/unit/content change or new listing was submitted for review */
  reviewSubmittedAt?: Date | null;
  /** Timestamp when admin approved/rejected the review */
  reviewedAt?: Date | null;
  /** APPROVED, UNDER_REVIEW, PENDING_REVIEW, or REJECTED */
  reviewStatus: ListingReviewStatus;
  /** Admin rejection reason / note */
  rejectionReason?: string | null;
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
    unit: { type: String, default: null },
    customDescription: { type: String, default: null },
    customNotes: { type: String, default: null },
    customAttributes: { type: Schema.Types.Mixed, default: null },
    customProductInformation: { type: Schema.Types.Mixed, default: null },
    pendingSellingPricePaise: { type: Number, default: null },
    pendingUnit: { type: String, default: null },
    pendingDescription: { type: String, default: null },
    pendingNotes: { type: String, default: null },
    pendingAttributes: { type: Schema.Types.Mixed, default: null },
    pendingProductInformation: { type: Schema.Types.Mixed, default: null },
    reviewSubmittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    status: { type: String, enum: LISTING_STATUS, default: 'ACTIVE' },
    availability: { type: String, enum: AVAILABILITY, default: 'AVAILABLE' },
    stock: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    reviewStatus: { type: String, enum: LISTING_REVIEW_STATUS, default: 'UNDER_REVIEW' },
    rejectionReason: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

SellerListingSchema.virtual('available').get(function (this: ISellerListing) {
  return Math.max(0, (this.stock || 0) - (this.reserved || 0));
});

SellerListingSchema.index({ sellerId: 1, masterProductId: 1 }, { unique: true });
SellerListingSchema.index({ sellerId: 1, status: 1 });
SellerListingSchema.index({ sellerId: 1, updatedAt: -1 });
/** Storefront: probe/join listed products by masterProductId */
SellerListingSchema.index({ masterProductId: 1, status: 1, reviewStatus: 1 });
/** Storefront: preferred-seller price lookup */
SellerListingSchema.index({ sellerId: 1, masterProductId: 1, status: 1, reviewStatus: 1 });
/** Storefront: auto seller resolution + best-price aggregation */
SellerListingSchema.index({ status: 1, reviewStatus: 1, sellerId: 1 });
SellerListingSchema.index({ status: 1, reviewStatus: 1, masterProductId: 1, sellingPricePaise: 1, availability: 1 });

export default mongoose.model<ISellerListing>('SellerListing', SellerListingSchema);
