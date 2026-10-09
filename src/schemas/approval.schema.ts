import { z } from 'zod';

export const ApprovalTypeSchema = z.enum(['folder', 'video', 'pdf', 'image']);
export const ApprovalStatusSchema = z.enum(['pending_review', 'approved', 'rejected']);

export const ApprovalSchema = z.object({
  id: z.string().regex(/^apr-\d{3}$/),
  title: z.string().min(1),
  type: ApprovalTypeSchema,
  submittedBy: z.string().min(1),
  status: ApprovalStatusSchema,
  // The assignment gives "Sep 18" with no year, so we keep it as a display label, not a Date.
  submittedDateLabel: z.string().min(1),
});

export const ApprovalListSchema = z.array(ApprovalSchema);

export const ApprovalsResponseSchema = z.object({
  approvals: ApprovalListSchema,
  source: z.enum(['mongodb', 'fixture']),
});

export type Approval = z.infer<typeof ApprovalSchema>;
export type ApprovalsResponse = z.infer<typeof ApprovalsResponseSchema>;
