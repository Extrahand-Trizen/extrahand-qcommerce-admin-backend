import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcrypt';
import { USER_ROLES, UserRole } from '../types';

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

const AdminUserSchema = new Schema<IAdminUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: USER_ROLES, default: 'ADMIN' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

AdminUserSchema.methods.comparePassword = async function (password: string): Promise<boolean> {
  return bcrypt.compare(password, this.passwordHash);
};

export default mongoose.model<IAdminUser>('QcAdminUser', AdminUserSchema, 'qc_admin_users');
