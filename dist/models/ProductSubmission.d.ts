import mongoose, { Document, Types } from 'mongoose';
import { SubmissionStatus, ProductAttributeValue } from '../types';
export interface IProductSubmission extends Document {
    sellerId: Types.ObjectId;
    submittedProductName: string;
    categoryId: Types.ObjectId;
    subcategoryId: Types.ObjectId;
    productTypeId: Types.ObjectId;
    brand?: string;
    description?: string;
    requestedAttributes: ProductAttributeValue[];
    images: string[];
    submissionNote?: string;
    status: SubmissionStatus;
    adminComment?: string;
    reviewedBy?: string;
    reviewedAt?: Date;
    mappedMasterProductId?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<IProductSubmission, {}, {}, {}, mongoose.Document<unknown, {}, IProductSubmission, {}, {}> & IProductSubmission & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
