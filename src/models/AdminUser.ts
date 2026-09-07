import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcrypt';
import { USER_ROLES, UserRole, ADMIN_STATUS, AdminStatus } from '../types';

export interface IAdminUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  status: AdminStatus;
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
    role: { type: String, enum: USER_ROLES, default: 'CATALOGUE_ADMIN' },
    status: { type: String, enum: ADMIN_STATUS, default: 'active' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes
AdminUserSchema.index({ role: 1 });
AdminUserSchema.index({ status: 1 });

AdminUserSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    this.isActive = this.status === 'active';
  } else if (this.isModified('isActive') && !this.isModified('status')) {
    this.status = this.isActive ? 'active' : 'inactive';
  }
  next();
});

AdminUserSchema.methods.comparePassword = async function (password: string): Promise<boolean> {
  return bcrypt.compare(password, this.passwordHash);
};

export default mongoose.model<IAdminUser>('QcAdminUser', AdminUserSchema, 'qc_admin_users');
