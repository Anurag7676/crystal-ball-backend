import { Schema, model } from 'mongoose';

const MessageSchema = new Schema(
  {
    role: { type: String, required: true, enum: ['user', 'assistant'] },
    content: { type: String, required: true },
    timestamp: { type: Date, required: true },
  },
  { _id: false },
);

// Only user/assistant turns are stored — never system prompts or credentials.
const ConversationDocSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    actionType: { type: String, required: true, enum: ['chat', 'help', 'teach'] },
    messages: { type: [MessageSchema], default: [] },
  },
  { timestamps: true, collection: 'conversations' },
);

ConversationDocSchema.index({ sessionId: 1, actionType: 1 }, { unique: true });

export const ConversationModel = model('Conversation', ConversationDocSchema);
