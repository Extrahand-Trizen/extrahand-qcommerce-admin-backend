import mongoose, { Schema, Document, Types } from 'mongoose';

export const PICKUP_QR_STATUS = ['ACTIVE', 'USED', 'REVOKED'] as const;
export type PickupQrStatus = (typeof PICKUP_QR_STATUS)[number];

export const PICKUP_QR_REVOKE_REASON = [
  'REPREPARED',
  'ORDER_CANCELLED',
  'STORE_DELETED',
] as const;
export type PickupQrRevokeReason = (typeof PICKUP_QR_REVOKE_REASON)[number];

export interface IPickupQrEvent {
  type: 'GENERATED' | 'REVOKED' | 'SCAN_OK' | 'SCAN_FAIL';
  at: Date;
  actorType: 'seller' | 'partner' | 'system';
  actorId?: string;
  meta?: Record<string, unknown>;
}

/**
 * One Order Pickup QR. Minted when the seller marks an order READY; the delivery
 * partner scans it in the mobile app to flip the order READY → HANDED_OVER.
 * Validity is lifecycle-driven — there is no `exp` on the token. A QR is only
 * usable while `status: 'ACTIVE'` and the order is still `READY`.
 */
export interface IOrderPickupQR extends Document {
  jti: string;
  orderId: Types.ObjectId;
  sellerId: Types.ObjectId;
  purpose: 'ORDER_PICKUP';
  status: PickupQrStatus;
  /** The signed JWT — stored so GET pickup-qr returns it without re-signing. */
  token: string;
  usedAt?: Date;
  usedByPartnerId?: string;
  usedByPartnerName?: string;
  revokedAt?: Date;
  revokedReason?: PickupQrRevokeReason;
  events: IPickupQrEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const PickupQrEventSchema = new Schema<IPickupQrEvent>(
  {
    type: { type: String, enum: ['GENERATED', 'REVOKED', 'SCAN_OK', 'SCAN_FAIL'], required: true },
    at: { type: Date, required: true },
    actorType: { type: String, enum: ['seller', 'partner', 'system'], required: true },
    actorId: { type: String },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const OrderPickupQRSchema = new Schema<IOrderPickupQR>(
  {
    jti: { type: String, required: true, unique: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'CustomerOrder', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    purpose: { type: String, enum: ['ORDER_PICKUP'], default: 'ORDER_PICKUP' },
    status: { type: String, enum: PICKUP_QR_STATUS, default: 'ACTIVE', index: true },
    token: { type: String, required: true },
    usedAt: { type: Date },
    usedByPartnerId: { type: String },
    usedByPartnerName: { type: String },
    revokedAt: { type: Date },
    revokedReason: { type: String, enum: PICKUP_QR_REVOKE_REASON },
    events: { type: [PickupQrEventSchema], default: [] },
  },
  { timestamps: true },
);

// The DB guarantees at most one live QR per order — the app never has to guard
// that race. Partial index so USED / REVOKED rows don't collide.
OrderPickupQRSchema.index(
  { orderId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);
OrderPickupQRSchema.index({ sellerId: 1, status: 1 });
OrderPickupQRSchema.index({ orderId: 1, createdAt: -1 });

export default mongoose.model<IOrderPickupQR>('OrderPickupQR', OrderPickupQRSchema);
