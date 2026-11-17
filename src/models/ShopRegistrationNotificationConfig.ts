import mongoose, { Schema, Document } from 'mongoose';

export interface IExclusiveNumberEntry {
  phone: string;
  name?: string;
}

export interface IShopRegistrationNotificationConfig extends Document {
  enabled: boolean;
  recipientEmails: string[];
  exclusiveMobileNumbers: string[];
  exclusions: IExclusiveNumberEntry[];
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ExclusiveNumberSchema = new Schema<IExclusiveNumberEntry>(
  {
    phone: { type: String, required: true },
    name: { type: String, default: '' },
  },
  { _id: false }
);

const ShopRegistrationNotificationConfigSchema = new Schema<IShopRegistrationNotificationConfig>(
  {
    enabled: { type: Boolean, default: true },
    recipientEmails: { type: [String], default: [] },
    exclusiveMobileNumbers: { type: [String], default: [] },
    exclusions: { type: [ExclusiveNumberSchema], default: [] },
    updatedBy: { type: String, default: 'admin' },
  },
  { timestamps: true }
);

export default mongoose.model<IShopRegistrationNotificationConfig>(
  'ShopRegistrationNotificationConfig',
  ShopRegistrationNotificationConfigSchema
);
