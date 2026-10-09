import type { Approval } from '../schemas/approval.schema';
import type { ChatMessage } from '../services/ai/openai.service';
import { ASSISTANT_IDENTITY, DATA_SAFETY_RULES, formatQueue, languageInstruction, type PromptDefinition } from './shared';

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

export const CHAT_PROMPT = CHAT_PROMPT_V2;
