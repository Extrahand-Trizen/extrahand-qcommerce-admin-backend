import mongoose, { Document, Types } from 'mongoose';
import { AttributeType } from '../types';
export interface IAttributeOption {
    label: string;
    value: string;
    displayOrder: number;
    isActive: boolean;
}
export interface IAttribute extends Document {
    name: string;
    key: string;
    type: AttributeType;
    description?: string;
    options: IAttributeOption[];
    isActive: boolean;
    createdBy?: string;
    updatedBy?: string;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<IAttribute, {}, {}, {}, mongoose.Document<unknown, {}, IAttribute, {}, {}> & IAttribute & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
