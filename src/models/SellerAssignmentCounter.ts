import mongoose, { Schema, Document } from 'mongoose';

export interface ISellerAssignmentCounter extends Document<string> {
  _id: string;
  seq: number;
}

const SellerAssignmentCounterSchema = new Schema<ISellerAssignmentCounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<ISellerAssignmentCounter>(
  'SellerAssignmentCounter',
  SellerAssignmentCounterSchema,
  'seller_assignment_counters'
);
