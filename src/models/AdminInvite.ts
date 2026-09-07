import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { ADMIN_ROLES, AdminRole } from '../types';

export interface IAdminInvite extends Document {
  inviteId: string;
  name: string;
  email: string;
  role: AdminRole;
  invitedBy: string;
  invitedByName: string;
  token: string;
  expiresAt: Date;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  acceptedAt?: Date;
  acceptedBy?: string;
  createdAt: Date;

  verifyToken(token: string): Promise<boolean>;
  isExpired(): boolean;
  canBeAccepted(): boolean;
}

export interface IAdminInviteModel extends Model<IAdminInvite> {
  createInvite(data: {
    name: string;
    email: string;
    role: AdminRole;
    invitedBy: string;
    invitedByName: string;
    expiresInDays?: number;
  }): Promise<{ invite: IAdminInvite; token: string }>;
}

const AdminInviteSchema = new Schema<IAdminInvite>(
  {
    inviteId: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ADMIN_ROLES,
      required: true,
    },
    invitedBy: {
      type: String,
      required: true,
    },
    invitedByName: {
      type: String,
      required: true,
    },
    token: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'expired', 'cancelled'],
      default: 'pending',
    },
    acceptedAt: {
      type: Date,
    },
    acceptedBy: {
      type: String,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    collection: 'qc_admin_invites',
  }
);

// Indexes
AdminInviteSchema.index({ email: 1 });
AdminInviteSchema.index({ status: 1 });
AdminInviteSchema.index({ expiresAt: 1 });
AdminInviteSchema.index({ role: 1 });

AdminInviteSchema.methods.verifyToken = async function (token: string): Promise<boolean> {
  return bcrypt.compare(token, this.token);
};

AdminInviteSchema.methods.isExpired = function (): boolean {
  return new Date() > this.expiresAt;
};

AdminInviteSchema.methods.canBeAccepted = function (): boolean {
  return this.status === 'pending' && !this.isExpired();
};

AdminInviteSchema.statics.createInvite = async function (data: {
  name: string;
  email: string;
  role: AdminRole;
  invitedBy: string;
  invitedByName: string;
  expiresInDays?: number;
}): Promise<{ invite: IAdminInvite; token: string }> {
  const token = uuidv4();
  const hashedToken = await bcrypt.hash(token, 10);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (data.expiresInDays || 7));

  const invite = new this({
    ...data,
    token: hashedToken,
    expiresAt,
    status: 'pending',
  });

  await invite.save();
  return { invite, token };
};

export default mongoose.model<IAdminInvite, IAdminInviteModel>(
  'QcAdminInvite',
  AdminInviteSchema,
  'qc_admin_invites'
);
