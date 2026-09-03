import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICustomerWishlistItem {
  productSlug: string;
  masterProductId: Types.ObjectId;
}

export interface ICustomerWishlist extends Document {
  userId: string;
  items: ICustomerWishlistItem[];
  createdAt: Date;
  updatedAt: Date;
}

const CustomerWishlistItemSchema = new Schema<ICustomerWishlistItem>(
  {
    productSlug: { type: String, required: true, trim: true },
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true },
  },
  { _id: false },
);

const CustomerWishlistSchema = new Schema<ICustomerWishlist>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    items: { type: [CustomerWishlistItemSchema], default: [] },
  },
  { timestamps: true },
);

CustomerWishlistSchema.index({ userId: 1, 'items.productSlug': 1 });

export default mongoose.model<ICustomerWishlist>('CustomerWishlist', CustomerWishlistSchema);
