import type { Approval } from '../schemas/approval.schema';
import type { ChatMessage } from '../services/ai/openai.service';
import {
  ASSISTANT_IDENTITY,
  CONVERSATION_RULE,
  DATA_SAFETY_RULES,
  formatQueue,
  languageInstruction,
  METADATA_ONLY_RULE,
  type PromptDefinition,
  QUEUE_AUTHORITY_RULE,
} from './shared';

export interface ChatContext {
  pending: Approval[];
  history: ChatMessage[];
  message: string;
  language?: string;
}

export const CHAT_PROMPT_V1: PromptDefinition<ChatContext> = {
  id: 'chat',
  version: 1,
  maxTokens: 450,
  temperature: 0.4,
  build: ({ pending, history, message, language }) => [
    {
      role: 'system',
      content: [
        ASSISTANT_IDENTITY,
        DATA_SAFETY_RULES,
        [
          'Answer the operator’s questions about the approval queue below. Rules:',
          '- Use only the queue data and the conversation so far. If something is not in the data, say so plainly.',
          '- When asked what to review first, you may suggest an order based on what the items contain ' +
            '(e.g. safety-related content first), and say it is a suggestion — the queue has no formal priorities.',
          '- Resolve follow-ups ("it", "that one") from the conversation.',
          '- Be concise: under 120 words, plain text, short numbered lists are fine.',
          '- If asked to approve, reject or change an item, explain that you cannot and the operator must do it.',
        ].join('\n'),
        languageInstruction(language),
        `<approval_queue>\n${formatQueue(pending)}\n</approval_queue>`,
      ].join('\n\n'),
    },
    ...history,
    { role: 'user', content: message },
  ],
};

/** V2: identical rules plus an explicit plain-text format — the UI renders text, not markdown. */
export const CHAT_PROMPT_V2: PromptDefinition<ChatContext> = {
  ...CHAT_PROMPT_V1,
  version: 2,
  build: (ctx) => {
    const [system, ...rest] = CHAT_PROMPT_V1.build(ctx);
    const formatRule =
      'Format: plain text only — no markdown (no **bold**, headings, tables or code blocks). ' +
      'Use "1." style numbered lines for lists.';
    return [{ role: 'system', content: `${system!.content}\n\n${formatRule}` }, ...rest];
  },
};

export interface ChatContextV3 {
  /** Every approval with its current status (not only pending ones). */
  queue: Approval[];
  history: ChatMessage[];
  message: string;
  language?: string;
}

/**
 * V3: the model sees the whole queue with current statuses (V1/V2 saw only pending items, so it
 * could not answer about decided items), the queue is declared authoritative over earlier turns,
 * and it is told it only has metadata — never file contents.
 */
export const CHAT_PROMPT_V3: PromptDefinition<ChatContextV3> = {
  id: 'chat',
  version: 3,
  maxTokens: 450,
  temperature: 0.4,
  build: ({ queue, history, message, language }) => [
    {
      role: 'system',
      content: [
        ASSISTANT_IDENTITY,
        DATA_SAFETY_RULES,
        [
          'Answer the operator’s questions about the approval queue below. Rules:',
          '- Use only the queue data and the conversation so far. If something is not in the data, say so plainly.',
          '- When asked what to review first, you may suggest an order among pending items based on what they are ' +
            '(e.g. safety-related content first), and say it is a suggestion — the queue has no formal priorities.',
          '- Resolve follow-ups ("it", "that one") from the conversation.',
          '- If asked to approve, reject or change an item, explain that you cannot and the operator must do it.',
          '- Be concise: under 120 words.',
          'Format: plain text only — no markdown (no **bold**, headings, tables or code blocks). Use "1." style ' +
            'numbered lines for lists.',
        ].join('\n'),
        QUEUE_AUTHORITY_RULE,
        METADATA_ONLY_RULE,
        CONVERSATION_RULE,
        languageInstruction(language),
        `<approval_queue>\n${formatQueue(queue)}\n</approval_queue>`,
      ].join('\n\n'),
    },
    ...history,
    { role: 'user', content: message },
  ],
};

export interface ChatContextV4 extends ChatContextV3 {
  /** True when older messages of this conversation exist but are not included below. */
  historyTruncated: boolean;
}

/**
 * V4: V3 plus explicit handling of partial history. V3 received only the last 10 messages; on a
 * long conversation the model saw "As I suggested earlier" without the suggestion and "corrected"
 * an answer that was right. The service now sends up to 20 messages (size-budgeted), and the
 * prompt says omitted context is not evidence of a mistake.
 */
export const CHAT_PROMPT_V4: PromptDefinition<ChatContextV4> = {
  ...CHAT_PROMPT_V3,
  version: 4,
  build: ({ historyTruncated, ...ctx }) => {
    const [system, ...rest] = CHAT_PROMPT_V3.build(ctx);
    const historyRule = [
      'Earlier parts of this conversation may not be shown to you.',
      'If an earlier answer refers to something you cannot see (for example "as I suggested earlier"), never assume ' +
        'an earlier answer was wrong because its basis is not shown.',
      'Do not apologise for, correct or retract an earlier answer unless the operator asks, or unless the current ' +
        'queue clearly contradicts it — in that case state what the current queue shows.',
      ...(historyTruncated ? ['Some earlier messages of this conversation are not shown here.'] : []),
    ].join(' ');
    return [{ role: 'system', content: `${system!.content}\n\n${historyRule}` }, ...rest];
  },
};

export const CHAT_PROMPT = CHAT_PROMPT_V4;
