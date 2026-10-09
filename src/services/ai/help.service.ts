import { HELP_PROMPT } from '../../prompts/help.prompt';
import type { ConversationRepository } from '../../repositories/conversation.repository';
import type { MessageRequest } from '../../schemas/ai.schema';
import { helpFallback } from '../../utils/fallback';
import type { Logger } from '../../utils/logger';
import type { TextStreamPlan } from '../../utils/streaming';
import { type PolicyChunk, verifyCitations } from '../rag/policy.service';
import { retrieve, tokenize } from '../rag/retriever';
import { loadHistory, persistTurn } from './conversation';
import type { LlmService } from './openai.service';

interface Deps {
  conversations: ConversationRepository;
  llm: LlmService;
  policy: PolicyChunk[];
  logger: Logger;
}

/**
 * "Help me": retrieval is deterministic (no AI); the LLM only phrases an answer from the
 * retrieved chunks. Retrieved chunk ids go to the client up front as `sources`.
 */
export function createHelpService({ conversations, llm, policy, logger }: Deps) {
  return {
    async prepare({ sessionId, message, language }: MessageRequest): Promise<TextStreamPlan> {
      const history = await loadHistory({ conversations, logger, sessionId, action: 'help' });

      let chunks = retrieve(message, policy);
      if (chunks.length === 0 && tokenize(message).length === 0) {
        // Purely referential follow-ups ("and what about that?") borrow terms from the previous
        // question. A new question with its own (unmatched) terms is a new topic: no borrowing.
        const previous = [...history].reverse().find((m) => m.role === 'user');
        if (previous) chunks = retrieve(`${previous.content} ${message}`, policy);
      }
      const sources = chunks.map((c) => c.id);
      const prompt = HELP_PROMPT;

      return {
        sources,
        generate: (signal) =>
          llm.stream({
            messages: prompt.build({ chunks, history, message, language }),
            maxTokens: prompt.maxTokens,
            temperature: prompt.temperature,
            signal,
          }),
        fallback: () => helpFallback(chunks),
        citedSources: (text) => {
          const { valid, invalid } = verifyCitations(text, sources);
          if (invalid.length) logger.warn('Model cited policy chunks it was not given', { invalid });
          return valid;
        },
        onComplete: persistTurn({ conversations, logger, sessionId, action: 'help' }, message),
      };
    },
  };
}
