import mongoose, { Document, Types } from 'mongoose';
import { ListingStatus, Availability } from '../types';
export interface ISellerListing extends Document {
    sellerId: Types.ObjectId;
    masterProductId: Types.ObjectId;
    sellerSku?: string;
    sellingPrice: number;
    compareAtPrice?: number;
    status: ListingStatus;
    availability: Availability;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<ISellerListing, {}, {}, {}, mongoose.Document<unknown, {}, ISellerListing, {}, {}> & ISellerListing & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
