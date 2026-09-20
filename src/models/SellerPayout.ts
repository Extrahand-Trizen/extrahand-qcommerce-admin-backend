import mongoose, { Schema, Document, Types } from 'mongoose';
import { SELLER_PAYOUT_STATUS, SellerPayoutStatus } from '../types';

export interface IMaskedBankAccount {
  accountHolderName: string;
  bankName?: string;
  accountNumberMasked: string;
  ifscCode: string;
}

export interface ISellerPayout extends Document {
  sellerId: Types.ObjectId;
  payoutId: string;
  amountPaise: number;
  status: SellerPayoutStatus;
  bankAccount: IMaskedBankAccount;
  ledgerTransactionIds: Types.ObjectId[];
  referenceNumber?: string;
  gatewayPayoutId?: string;
  failureReason?: string;
  requestedAt: Date;
  processedAt?: Date;
  settledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MaskedBankAccountSchema = new Schema<IMaskedBankAccount>(
  {
    accountHolderName: { type: String, required: true },
    bankName: { type: String },
    accountNumberMasked: { type: String, required: true },
    ifscCode: { type: String, required: true },
  },
  { _id: false },
);

const SellerPayoutSchema = new Schema<ISellerPayout>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    payoutId: { type: String, required: true, unique: true, index: true },
    amountPaise: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: SELLER_PAYOUT_STATUS,
      default: 'REQUESTED',
      index: true,
    },
    bankAccount: { type: MaskedBankAccountSchema, required: true },
    ledgerTransactionIds: [{ type: Schema.Types.ObjectId, ref: 'SellerLedger' }],
    referenceNumber: { type: String, trim: true },
    gatewayPayoutId: { type: String, trim: true },
    failureReason: { type: String },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    settledAt: { type: Date },
  },
  {
    timestamps: true,
  },
);

SellerPayoutSchema.index({ sellerId: 1, createdAt: -1 });
SellerPayoutSchema.index({ sellerId: 1, requestedAt: -1 });

export default mongoose.model<ISellerPayout>('SellerPayout', SellerPayoutSchema);
