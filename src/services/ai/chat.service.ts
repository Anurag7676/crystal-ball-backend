import { CHAT_PROMPT } from '../../prompts/chat.prompt';
import type { ApprovalRepository } from '../../repositories/approval.repository';
import type { ConversationRepository } from '../../repositories/conversation.repository';
import type { MessageRequest } from '../../schemas/ai.schema';
import { chatFallback } from '../../utils/fallback';
import type { Logger } from '../../utils/logger';
import type { TextStreamPlan } from '../../utils/streaming';
import { loadQueue } from './context';
import { loadHistoryWindow, persistTurn } from './conversation';
import type { LlmService } from './openai.service';

/** Talk to me sends up to the full stored history (20 messages)… */
export const HISTORY_TURNS_IN_PROMPT = 20;
/** …within a size budget (≈3k tokens), dropping the oldest whole messages first. */
export const HISTORY_CHAR_BUDGET = 12_000;

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
      const history = await loadHistoryWindow(
        { conversations, logger, sessionId, action: 'chat' },
        { maxMessages: HISTORY_TURNS_IN_PROMPT, maxChars: HISTORY_CHAR_BUDGET },
      );
      const prompt = CHAT_PROMPT;

      return {
        generate: (signal) =>
          llm.stream({
            messages: prompt.build({
              queue: all,
              history: history.messages,
              historyTruncated: history.truncated,
              message,
              language,
            }),
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
