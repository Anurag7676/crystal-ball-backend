import type { RequestHandler } from 'express';
import type { ApprovalRepository } from '../repositories/approval.repository';
import type { ConversationRepository } from '../repositories/conversation.repository';
import type { AiAction, GreetingRequest } from '../schemas/ai.schema';
import { createGreetingService } from '../services/ai/greeting.service';
import type { LlmService } from '../services/ai/openai.service';
import type { PolicyChunk } from '../services/rag/policy.service';
import type { Logger } from '../utils/logger';
import { streamText } from '../utils/streaming';

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

/** Controllers stay thin: the body is already Zod-validated; services decide what to send the model. */
export function createAiController(deps: AiControllerDeps): Record<AiAction, RequestHandler> {
  const { logger } = deps;
  const greeting = createGreetingService(deps);

  return {
    greeting: async (req, res) => {
      const plan = await greeting.prepare(req.body as GreetingRequest);
      await streamText(res, { action: 'greeting', plan, logger });
    },
    summary: notImplemented,
    chat: notImplemented,
    help: notImplemented,
    teach: notImplemented,
  };
}
