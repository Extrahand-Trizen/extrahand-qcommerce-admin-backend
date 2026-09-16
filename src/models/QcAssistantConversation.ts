import mongoose, { Schema, Document, Types } from 'mongoose';

export type QcAssistantMessageRole = 'user' | 'assistant' | 'system';

export interface IQcAssistantMessage {
  role: QcAssistantMessageRole;
  text: string;
  intent?: string;
  createdAt: Date;
}

export interface IQcAssistantConversation extends Document {
  conversationId: string;
  customerUserId: string;
  orderId?: Types.ObjectId;
  status: 'open' | 'closed';
  messages: IQcAssistantMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const QcAssistantMessageSchema = new Schema<IQcAssistantMessage>(
  {
    role: {
      type: String,
      enum: ['user', 'assistant', 'system'],
      required: true,
    },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    intent: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const QcAssistantConversationSchema = new Schema<IQcAssistantConversation>(
  {
    conversationId: { type: String, required: true, unique: true, index: true },
    customerUserId: { type: String, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'CustomerOrder', index: true },
    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
      index: true,
    },
    messages: { type: [QcAssistantMessageSchema], default: [] },
  },
  { timestamps: true },
);

QcAssistantConversationSchema.index(
  { customerUserId: 1, orderId: 1, status: 1 },
  { name: 'assistant_customer_order_status' },
);

export default mongoose.model<IQcAssistantConversation>(
  'QcAssistantConversation',
  QcAssistantConversationSchema,
);
