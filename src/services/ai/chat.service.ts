import { CHAT_PROMPT } from '../../prompts/chat.prompt';
import type { ApprovalRepository } from '../../repositories/approval.repository';
import type { ConversationRepository } from '../../repositories/conversation.repository';
import type { MessageRequest } from '../../schemas/ai.schema';
import { chatFallback } from '../../utils/fallback';
import type { Logger } from '../../utils/logger';
import type { TextStreamPlan } from '../../utils/streaming';
import { loadQueue } from './context';
import { loadHistory, persistTurn } from './conversation';
import type { LlmService } from './openai.service';

export { HISTORY_TURNS_IN_PROMPT } from './conversation';

interface Deps {
  approvals: ApprovalRepository;
  conversations: ConversationRepository;
  llm: LlmService;
  logger: Logger;
}

/**
 * "Talk to me": open-ended reasoning over the queue genuinely needs the LLM. The fallback only
 * answers questions the data can answer exactly (counts, lists, who submitted X); everything
 * else becomes a retryable error rather than a guess.
 */
export function createChatService({ approvals, conversations, llm, logger }: Deps) {
  return {
    async prepare({ sessionId, message, language }: MessageRequest): Promise<TextStreamPlan> {
      const { all } = await loadQueue(approvals);
      const history = await loadHistory({ conversations, logger, sessionId, action: 'chat' });
      const prompt = CHAT_PROMPT;

      return {
        generate: (signal) =>
          llm.stream({
            messages: prompt.build({ queue: all, history, message, language }),
            maxTokens: prompt.maxTokens,
            temperature: prompt.temperature,
            signal,
          }),
        fallback: () => chatFallback(message, all),
        onComplete: persistTurn({ conversations, logger, sessionId, action: 'chat' }, message),
      };
    },
  };
}
