import mongoose, { Document, Types } from 'mongoose';
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
declare const _default: mongoose.Model<IProductImage, {}, {}, {}, mongoose.Document<unknown, {}, IProductImage, {}, {}> & IProductImage & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
