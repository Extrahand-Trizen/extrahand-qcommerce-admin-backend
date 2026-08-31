import mongoose, { Document, Types } from 'mongoose';
import { EntityStatus, ProductAttributeValue } from '../types';
export interface IMasterProduct extends Document {
    categoryId: Types.ObjectId;
    subcategoryId: Types.ObjectId;
    productTypeId: Types.ObjectId;
    name: string;
    slug: string;
    brand?: string;
    description?: string;
    sku: string;
    gtin?: string;
    attributes: ProductAttributeValue[];
    complianceInfo?: string;
    status: EntityStatus;
    createdBy?: string;
    updatedBy?: string;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<IMasterProduct, {}, {}, {}, mongoose.Document<unknown, {}, IMasterProduct, {}, {}> & IMasterProduct & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
