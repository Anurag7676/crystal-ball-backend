import { TEACH_PROMPT } from '../../prompts/teach.prompt';
import type { ApprovalRepository } from '../../repositories/approval.repository';
import type { ConversationRepository } from '../../repositories/conversation.repository';
import type { MessageRequest } from '../../schemas/ai.schema';
import { teachFallback } from '../../utils/fallback';
import type { Logger } from '../../utils/logger';
import type { TextStreamPlan } from '../../utils/streaming';
import { type PolicyChunk, verifyCitations } from '../rag/policy.service';
import { loadHistory, persistTurn } from './conversation';
import type { LlmService } from './openai.service';

interface Deps {
  approvals: ApprovalRepository;
  conversations: ConversationRepository;
  llm: LlmService;
  policy: PolicyChunk[];
  logger: Logger;
}

/**
 * "Teach me": the steps themselves are fixed policy (the fallback proves that); the LLM earns its
 * place by adapting explanations to follow-ups. The whole mock policy fits in the prompt, so no
 * retrieval is needed here.
 */
export function createTeachService({ approvals, conversations, llm, policy, logger }: Deps) {
  return {
    async prepare({ sessionId, message, language }: MessageRequest): Promise<TextStreamPlan> {
      const pending = (await approvals.list()).filter((a) => a.status === 'pending_review');
      const history = await loadHistory({ conversations, logger, sessionId, action: 'teach' });
      const sources = policy.map((c) => c.id);
      const prompt = TEACH_PROMPT;

      return {
        sources,
        generate: (signal) =>
          llm.stream({
            messages: prompt.build({ policy, pending, history, message, language }),
            maxTokens: prompt.maxTokens,
            temperature: prompt.temperature,
            signal,
          }),
        fallback: () => teachFallback(policy),
        citedSources: (text) => verifyCitations(text, sources).valid,
        onComplete: persistTurn({ conversations, logger, sessionId, action: 'teach' }, message),
      };
    },
  };
}
