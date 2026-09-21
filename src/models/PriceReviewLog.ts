import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPriceReviewLog extends Document {
  sellerListingId: Types.ObjectId;
  sellerId: Types.ObjectId;
  masterProductId: Types.ObjectId;
  requestedPricePaise?: number | null;
  requestedUnit?: string | null;
  previousPricePaise?: number | null;
  previousUnit?: string | null;
  status: 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
  reviewedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PriceReviewLogSchema = new Schema<IPriceReviewLog>(
  {
    sellerListingId: { type: Schema.Types.ObjectId, ref: 'SellerListing', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true, index: true },
    requestedPricePaise: { type: Number, default: null },
    requestedUnit: { type: String, default: null },
    previousPricePaise: { type: Number, default: null },
    previousUnit: { type: String, default: null },
    status: { type: String, enum: ['APPROVED', 'REJECTED'], required: true, index: true },
    rejectionReason: { type: String, default: null },
    reviewedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.models.PriceReviewLog || mongoose.model<IPriceReviewLog>('PriceReviewLog', PriceReviewLogSchema);
