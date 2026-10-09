import { Schema, model } from 'mongoose';

const ApprovalDocSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    type: { type: String, required: true, enum: ['folder', 'video', 'pdf', 'image'] },
    submittedBy: { type: String, required: true },
    status: { type: String, required: true, enum: ['pending_review', 'approved', 'rejected'] },
    submittedDateLabel: { type: String, required: true },
  },
  { timestamps: true, collection: 'approvals' },
);

export const ApprovalModel = model('Approval', ApprovalDocSchema);
