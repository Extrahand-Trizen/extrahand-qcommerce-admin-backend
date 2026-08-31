import mongoose, { Document } from 'mongoose';
import { UserRole } from '../types';
export interface IAdminUser extends Document {
    email: string;
    passwordHash: string;
    name: string;
    role: UserRole;
    isActive: boolean;
    lastLoginAt?: Date;
    createdAt: Date;
    updatedAt: Date;
    comparePassword(password: string): Promise<boolean>;
}
declare const _default: mongoose.Model<IAdminUser, {}, {}, {}, mongoose.Document<unknown, {}, IAdminUser, {}, {}> & IAdminUser & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default _default;
