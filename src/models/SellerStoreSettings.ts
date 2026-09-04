import mongoose, { Schema, Document, Types } from 'mongoose';
import {
  STORE_STATUS,
  StoreStatus,
  STORE_STATUS_MODE,
  StoreStatusMode,
  WEEKDAYS,
  Weekday,
  DOCUMENT_VERIFICATION_STATUS,
  DocumentVerificationStatus,
} from '../types';

/** Payout bank account. Stored now; admin verification wired later (payouts phase). */
export interface IBankAccount {
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName?: string;
  upiId?: string;
  verificationStatus: DocumentVerificationStatus;
  verifiedAt?: Date;
  verifiedBy?: string;
}

/**
 * Per-seller operational settings — the things a shopkeeper changes day to day
 * (open/closed, hours, payout account). Kept separate from SellerOnboarding,
 * which is the admin-reviewed registration record and must not churn.
 * One document per seller, lazily created on first read.
 */
export interface ISellerStoreSettings extends Document {
  sellerId: Types.ObjectId;
  storeStatus: StoreStatus;
  statusMode: StoreStatusMode;
  /** "HH:mm" 24h. */
  openTime: string;
  closeTime: string;
  daysOpen: Weekday[];
  bankAccount?: IBankAccount;
  /* --- Track B: rejection-cycle bookkeeping (see SellerFulfillmentHealthService) --- */
  /** The IST calendar day ("YYYY-MM-DD") the two counters below belong to.
   *  When a reject/read lands on a later day the counters reset to 0. */
  rejectionDay?: string;
  /** Rejections + accept-timeouts so far today. Informational; midnight IST resets it. */
  dailyRejectedCount: number;
  /** Rejections + accept-timeouts in the current cycle. Hits
   *  REJECTION_CYCLE_THRESHOLD → the shop auto-pauses; back to 0 once the pause
   *  expires (or at midnight). */
  rejectionCycleCount: number;
  /** When the current cycle's first rejection landed. */
  rejectionCycleStartedAt?: Date;
  /** Set when the shop was auto-paused for too many rejected/missed orders.
   *  Cleared when the pause expires or the shopkeeper reopens manually. */
  autoPausedAt?: Date;
  /** When the auto-pause expires and the shop reopens itself. */
  pauseUntil?: Date;
  /** Shown in the shopkeeper's pause banner. */
  pauseReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BankAccountSchema = new Schema<IBankAccount>(
  {
    accountHolderName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    ifscCode: { type: String, required: true, uppercase: true, trim: true },
    bankName: { type: String, trim: true },
    upiId: { type: String, trim: true },
    verificationStatus: {
      type: String,
      enum: DOCUMENT_VERIFICATION_STATUS,
      default: 'PENDING',
    },
    verifiedAt: { type: Date },
    verifiedBy: { type: String },
  },
  { _id: false }
);

const SellerStoreSettingsSchema = new Schema<ISellerStoreSettings>(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
      unique: true,
      index: true,
    },
    storeStatus: { type: String, enum: STORE_STATUS, default: 'OPEN' },
    statusMode: { type: String, enum: STORE_STATUS_MODE, default: 'MANUAL' },
    openTime: { type: String, default: '09:00' },
    closeTime: { type: String, default: '21:00' },
    daysOpen: {
      type: [{ type: String, enum: WEEKDAYS }],
      default: () => [...WEEKDAYS],
    },
    bankAccount: { type: BankAccountSchema, default: undefined },
    rejectionDay: { type: String },
    dailyRejectedCount: { type: Number, default: 0, min: 0 },
    rejectionCycleCount: { type: Number, default: 0, min: 0 },
    rejectionCycleStartedAt: { type: Date },
    autoPausedAt: { type: Date },
    pauseUntil: { type: Date },
    pauseReason: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model<ISellerStoreSettings>(
  'SellerStoreSettings',
  SellerStoreSettingsSchema
);
