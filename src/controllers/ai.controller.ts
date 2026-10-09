import type { RequestHandler } from 'express';
import type { ApprovalRepository } from '../repositories/approval.repository';
import type { ConversationRepository } from '../repositories/conversation.repository';
import type { AiAction } from '../schemas/ai.schema';
import type { LlmService } from '../services/ai/openai.service';
import type { PolicyChunk } from '../services/rag/policy.service';
import type { Logger } from '../utils/logger';

export interface AiControllerDeps {
  approvals: ApprovalRepository;
  conversations: ConversationRepository;
  llm: LlmService;
  policy: PolicyChunk[];
  logger: Logger;
}

const notImplemented: RequestHandler = (_req, res) => {
  res.status(501).json({ error: { code: 'internal_error', message: 'Not implemented yet' } });
};

export function createAiController(_deps: AiControllerDeps): Record<AiAction, RequestHandler> {
  return {
    greeting: notImplemented,
    summary: notImplemented,
    chat: notImplemented,
    help: notImplemented,
    teach: notImplemented,
  };
}
