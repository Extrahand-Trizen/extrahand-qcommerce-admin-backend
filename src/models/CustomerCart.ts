import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICustomerCartItem {
  productSlug: string;
  masterProductId: Types.ObjectId;
  quantity: number;
}

export interface ICustomerCart extends Document {
  userId: string;
  items: ICustomerCartItem[];
  createdAt: Date;
  updatedAt: Date;
}

const CustomerCartItemSchema = new Schema<ICustomerCartItem>(
  {
    productSlug: { type: String, required: true, trim: true },
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false },
);

const CustomerCartSchema = new Schema<ICustomerCart>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    items: { type: [CustomerCartItemSchema], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model<ICustomerCart>('CustomerCart', CustomerCartSchema);
