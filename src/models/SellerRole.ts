import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISellerRole extends Document {
  sellerId: Types.ObjectId;
  name: string;
  description?: string;
  isSystem: boolean;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

const SellerRoleSchema = new Schema<ISellerRole>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    isSystem: { type: Boolean, default: false },
    permissions: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

SellerRoleSchema.index({ sellerId: 1, name: 1 }, { unique: true });

export default mongoose.model<ISellerRole>('SellerRole', SellerRoleSchema);

