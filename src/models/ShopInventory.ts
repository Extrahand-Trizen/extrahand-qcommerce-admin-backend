import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IShopInventory extends Document {
  sellerId: Types.ObjectId;
  listingId: Types.ObjectId;
  masterProductId: Types.ObjectId;
  /** Physical stock count for this particular shop/fulfillment location */
  stock: number;
  /** Reserved stock held by pending unfulfilled orders */
  reserved: number;
  /** Available stock (computed as Math.max(0, stock - reserved)) */
  available: number;
  locationName: string;
  createdAt: Date;
  updatedAt: Date;
}

const ShopInventorySchema = new Schema<IShopInventory>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    listingId: { type: Schema.Types.ObjectId, ref: 'SellerListing', required: true, index: true },
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true, index: true },
    stock: { type: Number, default: 0, min: 0, required: true },
    reserved: { type: Number, default: 0, min: 0, required: true },
    locationName: { type: String, default: 'Main Store', trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ShopInventorySchema.virtual('available').get(function (this: IShopInventory) {
  return Math.max(0, (this.stock || 0) - (this.reserved || 0));
});

ShopInventorySchema.index({ sellerId: 1, listingId: 1 }, { unique: true });
ShopInventorySchema.index({ sellerId: 1, masterProductId: 1 }, { unique: true });

export default mongoose.model<IShopInventory>('ShopInventory', ShopInventorySchema);
