import { Router } from 'express';
import { createApprovalsController } from '../controllers/approvals.controller';
import type { ApprovalRepository } from '../repositories/approval.repository';

export function createApprovalsRouter(approvals: ApprovalRepository): Router {
  const router = Router();
  const controller = createApprovalsController(approvals);
  router.get('/', controller.list);
  return router;
}
