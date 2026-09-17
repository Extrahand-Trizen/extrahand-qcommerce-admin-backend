import mongoose, { Schema, Document, Types } from 'mongoose';
import {
  SELLER_LEDGER_TRANSACTION_TYPE,
  SellerLedgerTransactionType,
  SELLER_LEDGER_STATUS,
  SellerLedgerStatus,
} from '../types';

export interface ISellerLedger extends Document {
  sellerId: Types.ObjectId;
  orderId?: Types.ObjectId;
  orderNumber?: string;
  transactionType: SellerLedgerTransactionType;
  grossAmountPaise: number;
  commissionAmountPaise: number;
  taxOnCommissionPaise: number;
  adjustmentAmountPaise: number;
  netAmountPaise: number;
  status: SellerLedgerStatus;
  paymentId?: string;
  payoutId?: string;
  paidAt?: Date;
  completedAt?: Date;
  settlementEligibleAt?: Date;
  settledAt?: Date;
  failureReason?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const SellerLedgerSchema = new Schema<ISellerLedger>(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'CustomerOrder', index: true },
    orderNumber: { type: String, trim: true },
    transactionType: {
      type: String,
      enum: SELLER_LEDGER_TRANSACTION_TYPE,
      required: true,
      index: true,
    },
    grossAmountPaise: { type: Number, required: true, min: 0 },
    commissionAmountPaise: { type: Number, default: 0, min: 0 },
    taxOnCommissionPaise: { type: Number, default: 0, min: 0 },
    adjustmentAmountPaise: { type: Number, default: 0 },
    netAmountPaise: { type: Number, required: true },
    status: {
      type: String,
      enum: SELLER_LEDGER_STATUS,
      default: 'PENDING_ORDER_COMPLETION',
      index: true,
    },
    paymentId: { type: String, trim: true, index: true },
    payoutId: { type: String, trim: true, index: true },
    paidAt: { type: Date },
    completedAt: { type: Date },
    settlementEligibleAt: { type: Date, index: true },
    settledAt: { type: Date },
    failureReason: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
  },
);

SellerLedgerSchema.index({ sellerId: 1, status: 1 });
SellerLedgerSchema.index({ status: 1, settlementEligibleAt: 1 });
SellerLedgerSchema.index({ sellerId: 1, createdAt: -1 });
SellerLedgerSchema.index({ sellerId: 1, orderId: 1, transactionType: 1 });

export default mongoose.model<ISellerLedger>('SellerLedger', SellerLedgerSchema);
