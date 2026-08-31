import mongoose, { Document, Types } from 'mongoose';
import { EntityStatus } from '../types';
export interface ICategory extends Document {
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
declare const _default: mongoose.Model<ICategory, {}, {}, {}, mongoose.Document<unknown, {}, ICategory, {}, {}> & ICategory & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
