import mongoose, { Schema, Document, Types } from 'mongoose';
import { StaffStatus, STAFF_STATUS } from '../types';

export interface IStaffDevice {
  deviceId: string;
  deviceName?: string;
  os?: string;
  appVersion?: string;
  lastActiveAt: Date;
  ipAddress?: string;
}

export interface ISellerStaff extends Document {
  sellerId: Types.ObjectId;
  userId?: string;
  name: string;
  phone: string;
  roleId?: Types.ObjectId;
  role: string;
  permissions: string[];
  status: StaffStatus;
  addedBy: string;
  invitedAt: Date;
  invitationExpiresAt?: Date;
  acceptedAt?: Date;
  activatedAt?: Date;
  lastLoginAt?: Date;
  lastLoginIp?: string;
  sessionVersion: number;
  devices: IStaffDevice[];
  temporaryUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StaffDeviceSchema = new Schema<IStaffDevice>(
  {
    deviceId: { type: String, required: true },
    deviceName: { type: String, default: '' },
    os: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    lastActiveAt: { type: Date, default: Date.now },
    ipAddress: { type: String, default: '' },
  },
  { _id: false }
);

const SellerStaffSchema = new Schema<ISellerStaff>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    userId: { type: String, sparse: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'SellerRole', index: true },
    role: { type: String, required: true, default: 'Order Helper / Packer' },
    permissions: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: STAFF_STATUS,
      default: 'PENDING',
      index: true,
    },
    addedBy: { type: String, required: true },
    invitedAt: { type: Date, default: Date.now },
    invitationExpiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days expiry by default
    },
    acceptedAt: { type: Date },
    activatedAt: { type: Date },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String },
    sessionVersion: { type: Number, default: 1 },
    devices: {
      type: [StaffDeviceSchema],
      default: [],
    },
    temporaryUntil: { type: Date },
  },
  { timestamps: true }
);

SellerStaffSchema.index({ sellerId: 1, phone: 1 }, { unique: true });
SellerStaffSchema.index({ phone: 1, status: 1 });

export default mongoose.model<ISellerStaff>('SellerStaff', SellerStaffSchema);
