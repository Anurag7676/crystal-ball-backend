import type { RequestHandler } from 'express';
import type { ApprovalRepository } from '../repositories/approval.repository';
import type { ApprovalsResponse } from '../schemas/approval.schema';

export const createApprovalsController = (approvals: ApprovalRepository): { list: RequestHandler } => ({
  list: async (_req, res) => {
    const body: ApprovalsResponse = { approvals: await approvals.list(), source: approvals.source };
    res.json(body);
  },
});
