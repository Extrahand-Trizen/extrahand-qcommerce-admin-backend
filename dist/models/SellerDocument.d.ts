import mongoose, { Document, Types } from 'mongoose';
import { DocumentType, DocumentVerificationStatus } from '../types';
export interface ISellerDocument extends Document {
    sellerId: Types.ObjectId;
    onboardingId: Types.ObjectId;
    documentType: DocumentType;
    documentNumber?: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    verificationStatus: DocumentVerificationStatus;
    rejectionReason?: string;
    uploadedAt: Date;
    verifiedAt?: Date;
    verifiedBy?: string;
}
declare const _default: mongoose.Model<ISellerDocument, {}, {}, {}, mongoose.Document<unknown, {}, ISellerDocument, {}, {}> & ISellerDocument & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
