import type { RequestHandler } from 'express';
import type { ApprovalRepository } from '../repositories/approval.repository';
import type { ConversationRepository } from '../repositories/conversation.repository';
import type { AiAction, GreetingRequest, MessageRequest, SummaryRequest } from '../schemas/ai.schema';
import { createChatService } from '../services/ai/chat.service';
import { createGreetingService } from '../services/ai/greeting.service';
import { createHelpService } from '../services/ai/help.service';
import type { LlmService } from '../services/ai/openai.service';
import { createSummaryService } from '../services/ai/summary.service';
import { createTeachService } from '../services/ai/teach.service';
import type { PolicyChunk } from '../services/rag/policy.service';
import type { Logger } from '../utils/logger';
import { streamStructured, streamText, type TextStreamPlan } from '../utils/streaming';

export interface AiControllerDeps {
  approvals: ApprovalRepository;
  conversations: ConversationRepository;
  llm: LlmService;
  policy: PolicyChunk[];
  logger: Logger;
}

/** Controllers stay thin: the body is already Zod-validated; services decide what to send the model. */
export function createAiController(deps: AiControllerDeps): Record<AiAction, RequestHandler> {
  const { logger } = deps;
  const greeting = createGreetingService(deps);
  const summary = createSummaryService(deps);
  const chat = createChatService(deps);
  const help = createHelpService(deps);
  const teach = createTeachService(deps);

  const textHandler =
    <B>(action: AiAction, prepare: (body: B) => Promise<TextStreamPlan>): RequestHandler =>
    async (req, res) => {
      const plan = await prepare(req.body as B);
      await streamText(res, { action, plan, logger });
    };

  return {
    greeting: textHandler<GreetingRequest>('greeting', greeting.prepare),
    chat: textHandler<MessageRequest>('chat', chat.prepare),
    help: textHandler<MessageRequest>('help', help.prepare),
    teach: textHandler<MessageRequest>('teach', teach.prepare),
    summary: async (req, res) => {
      await streamStructured(res, {
        action: 'summary',
        logger,
        run: async (signal) => {
          const { summary: data, source, fallbackReason } = await summary.generate(req.body as SummaryRequest, signal);
          return { result: { kind: 'summary', summary: data }, source, fallbackReason };
        },
      });
    },
  };
}
