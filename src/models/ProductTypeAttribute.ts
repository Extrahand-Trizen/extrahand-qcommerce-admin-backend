import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProductTypeAttribute extends Document {
  productTypeId: Types.ObjectId;
  attributeId: Types.ObjectId;
  isRequired: boolean;
  displayOrder: number;
  defaultValue?: string;
  /** When true, this attribute's value is part of the pack/variant label shown
   *  to sellers & customers (e.g. quantity + unit -> "1 kg"). */
  isVariantAttribute: boolean;
  /** Order of this attribute within the composed variant label. */
  variantOrder: number;
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
    isVariantAttribute: { type: Boolean, default: false },
    variantOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ProductTypeAttributeSchema.index({ productTypeId: 1, attributeId: 1 }, { unique: true });

export default mongoose.model<IProductTypeAttribute>('ProductTypeAttribute', ProductTypeAttributeSchema);
