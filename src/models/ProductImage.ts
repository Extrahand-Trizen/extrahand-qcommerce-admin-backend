import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProductImage extends Document {
  masterProductId: Types.ObjectId;
  imageUrl: string;
  altText?: string;
  displayOrder: number;
  isPrimary: boolean;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  createdAt: Date;
}

const ProductImageSchema = new Schema<IProductImage>(
  {
    masterProductId: { type: Schema.Types.ObjectId, ref: 'MasterProduct', required: true, index: true },
    imageUrl: { type: String, required: true },
    altText: { type: String },
    displayOrder: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false },
    fileName: { type: String },
    mimeType: { type: String },
    fileSize: { type: Number },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ProductImageSchema.index({ masterProductId: 1, isPrimary: -1, displayOrder: 1 });

export default mongoose.model<IProductImage>('ProductImage', ProductImageSchema);
