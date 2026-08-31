import mongoose, { Document, Types } from 'mongoose';
import { EntityStatus } from '../types';
export interface IProductType extends Document {
    categoryId: Types.ObjectId;
    subcategoryId: Types.ObjectId;
    name: string;
    slug: string;
    description?: string;
    displayOrder: number;
    status: EntityStatus;
    createdBy?: string;
    updatedBy?: string;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<IProductType, {}, {}, {}, mongoose.Document<unknown, {}, IProductType, {}, {}> & IProductType & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
