import { HELP_PROMPT } from '../../prompts/help.prompt';
import type { ApprovalRepository } from '../../repositories/approval.repository';
import type { ConversationRepository } from '../../repositories/conversation.repository';
import type { MessageRequest } from '../../schemas/ai.schema';
import { helpFallback } from '../../utils/fallback';
import type { Logger } from '../../utils/logger';
import type { TextStreamPlan } from '../../utils/streaming';
import { type PolicyChunk, stripUnverifiedCitations, verifyCitations } from '../rag/policy.service';
import { retrieve, tokenize } from '../rag/retriever';
import { loadQueue, policyVocabulary, referencedInConversation } from './context';
import { loadHistory, persistTurn } from './conversation';
import type { ChatMessage, LlmService } from './openai.service';

/** Upper bound on sections sent to the model per request (retrieved + carried). */
export const MAX_CONTEXT_CHUNKS = 4;

interface Deps {
  approvals: ApprovalRepository;
  conversations: ConversationRepository;
  llm: LlmService;
  policy: PolicyChunk[];
  logger: Logger;
}

/** Sections cited in earlier assistant answers, most recent first, without duplicates. */
function citedInHistory(history: ChatMessage[], policy: PolicyChunk[]): PolicyChunk[] {
  const allIds = policy.map((c) => c.id);
  const ids: string[] = [];
  for (const m of [...history].reverse()) {
    if (m.role !== 'assistant') continue;
    for (const id of verifyCitations(m.content, allIds).valid) if (!ids.includes(id)) ids.push(id);
  }
  return ids.map((id) => policy.find((c) => c.id === id)!);
}

/**
 * "Help me": retrieval is deterministic (no AI); the LLM only phrases an answer from the
 * included chunks. Sections cited earlier in the conversation stay in context so follow-ups
 * can still see (and cite) them. Included chunk ids go to the client up front as `sources`.
 */
export function createHelpService({ approvals, conversations, llm, policy, logger }: Deps) {
  const genericWords = policyVocabulary(policy);
  return {
    async prepare({ sessionId, message, language }: MessageRequest): Promise<TextStreamPlan> {
      const history = await loadHistory({ conversations, logger, sessionId, action: 'help' });

      let retrieved = retrieve(message, policy);
      if (retrieved.length === 0 && tokenize(message).length === 0) {
        // Purely referential follow-ups ("and what about that?") borrow terms from the previous
        // question. A new question with its own (unmatched) terms is a new topic: no borrowing.
        const previous = [...history].reverse().find((m) => m.role === 'user');
        if (previous) retrieved = retrieve(`${previous.content} ${message}`, policy);
      }
      const retrievedIds = retrieved.map((c) => c.id);
      const carried = citedInHistory(history, policy)
        .filter((c) => !retrievedIds.includes(c.id))
        .slice(0, Math.max(0, MAX_CONTEXT_CHUNKS - retrieved.length));
      const sources = [...retrievedIds, ...carried.map((c) => c.id)];
      // Approval metadata only when the question (or its antecedent) names an item.
      const referenced = referencedInConversation(message, history, (await loadQueue(approvals)).all, genericWords);
      const prompt = HELP_PROMPT;
      const persist = persistTurn({ conversations, logger, sessionId, action: 'help' }, message);

      return {
        sources,
        generate: (signal) =>
          llm.stream({
            messages: prompt.build({ index: policy, retrieved, carried, referenced, history, message, language }),
            maxTokens: prompt.maxTokens,
            temperature: prompt.temperature,
            signal,
          }),
        // The fallback quotes only what matched *this* question, never carried context.
        fallback: () => helpFallback(retrieved),
        citedSources: (text) => {
          const { valid, invalid } = verifyCitations(text, sources);
          if (invalid.length) logger.warn('Model cited policy chunks it was not given', { invalid });
          return valid;
        },
        // Store the reply with out-of-context citations removed so they can't mislead later turns.
        onComplete: (reply) => persist(stripUnverifiedCitations(reply, sources)),
      };
    },
  };
}
