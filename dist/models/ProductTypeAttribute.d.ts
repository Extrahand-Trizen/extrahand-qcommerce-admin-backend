import mongoose, { Document, Types } from 'mongoose';
export interface IProductTypeAttribute extends Document {
    productTypeId: Types.ObjectId;
    attributeId: Types.ObjectId;
    isRequired: boolean;
    displayOrder: number;
    defaultValue?: string;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<IProductTypeAttribute, {}, {}, {}, mongoose.Document<unknown, {}, IProductTypeAttribute, {}, {}> & IProductTypeAttribute & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
