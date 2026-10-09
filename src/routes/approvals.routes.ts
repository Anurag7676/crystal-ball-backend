import { Router } from 'express';
import { createApprovalsController } from '../controllers/approvals.controller';
import { validateQuery } from '../middleware/validate';
import type { ApprovalRepository } from '../repositories/approval.repository';
import { ApprovalQuerySchema } from '../schemas/approval.schema';

export function createApprovalsRouter(approvals: ApprovalRepository): Router {
  const router = Router();
  const controller = createApprovalsController(approvals);
  router.get('/', validateQuery(ApprovalQuerySchema), controller.list);
  return router;
}
