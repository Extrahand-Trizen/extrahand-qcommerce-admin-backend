import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcrypt';
import { USER_ROLES, UserRole } from '../types';

export interface IAdminUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  status: 'active' | 'inactive' | 'suspended';
  isActive: boolean;
  /** Whether a SELLER_OPERATIONS_ADMIN participates in round-robin seller assignments. */
  receivesSellerAssignments: boolean;
  /** Monotonic sequence assigned on each round-robin pick to guarantee fair rotation. */
  lastSellerAssignedSeq: number;
  lastSellerAssignedAt?: Date;
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
    role: { type: String, enum: USER_ROLES, default: 'CATALOGUE_ADMIN' },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
    isActive: { type: Boolean, default: true },
    receivesSellerAssignments: { type: Boolean, default: true },
    lastSellerAssignedSeq: { type: Number, default: 0 },
    lastSellerAssignedAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

AdminUserSchema.index({ createdAt: -1 });
AdminUserSchema.index({ role: 1, status: 1 });
AdminUserSchema.index({ role: 1, status: 1, isActive: 1, receivesSellerAssignments: 1, lastSellerAssignedSeq: 1 });

AdminUserSchema.methods.comparePassword = async function (password: string): Promise<boolean> {
  return bcrypt.compare(password, this.passwordHash);
};

export default mongoose.model<IAdminUser>('QcAdminUser', AdminUserSchema, 'qc_admin_users');
