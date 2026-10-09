import type { RequestHandler } from 'express';
import type { ApprovalRepository } from '../repositories/approval.repository';
import type { ApprovalQuery, ApprovalsResponse } from '../schemas/approval.schema';

export const createApprovalsController = (approvals: ApprovalRepository): { list: RequestHandler } => ({
  list: async (_req, res) => {
    const page = await approvals.query(res.locals.query as ApprovalQuery);
    const body: ApprovalsResponse = { ...page, source: approvals.source };
    res.json(body);
  },
});
