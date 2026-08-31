import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProductTypeAttribute extends Document {
  productTypeId: Types.ObjectId;
  attributeId: Types.ObjectId;
  isRequired: boolean;
  displayOrder: number;
  defaultValue?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProductTypeAttributeSchema = new Schema<IProductTypeAttribute>(
  {
    productTypeId: { type: Schema.Types.ObjectId, ref: 'ProductType', required: true, index: true },
    attributeId: { type: Schema.Types.ObjectId, ref: 'Attribute', required: true, index: true },
    isRequired: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 0 },
    defaultValue: { type: String },
  },
  { timestamps: true }
);

ProductTypeAttributeSchema.index({ productTypeId: 1, attributeId: 1 }, { unique: true });

export default mongoose.model<IProductTypeAttribute>('ProductTypeAttribute', ProductTypeAttributeSchema);
