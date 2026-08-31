import mongoose, { Document, Types } from 'mongoose';
import { EntityStatus } from '../types';
export interface ISubcategory extends Document {
    categoryId: Types.ObjectId;
    name: string;
    slug: string;
    description?: string;
    imageUrl?: string;
    displayOrder: number;
    status: EntityStatus;
    createdBy?: string;
    updatedBy?: string;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<ISubcategory, {}, {}, {}, mongoose.Document<unknown, {}, ISubcategory, {}, {}> & ISubcategory & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
