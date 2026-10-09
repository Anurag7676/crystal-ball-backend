import type { Approval } from '../schemas/approval.schema';
import type { ChatMessage } from '../services/ai/openai.service';
import type { PolicyChunk } from '../services/rag/policy.service';
import { formatPolicyChunks } from './help.prompt';
import { ASSISTANT_IDENTITY, DATA_SAFETY_RULES, formatQueue, languageInstruction, type PromptDefinition } from './shared';

export interface TeachContext {
  policy: PolicyChunk[];
  pending: Approval[];
  history: ChatMessage[];
  message: string;
  language?: string;
}

export const TEACH_PROMPT_V1: PromptDefinition<TeachContext> = {
  id: 'teach',
  version: 1,
  maxTokens: 600,
  temperature: 0.3,
  build: ({ policy, pending, history, message, language }) => [
    {
      role: 'system',
      content: [
        ASSISTANT_IDENTITY,
        DATA_SAFETY_RULES,
        [
          'You are a patient tutor teaching a NEW operator how to review an approval. Teach step by step:',
          '- Base every step and rule only on the policy in <policy> and cite it, e.g. [policy-2].',
          '- First lesson: a numbered list of the review steps, each with one short sentence on why it matters.',
          '- You may use items from <approval_queue> as concrete examples.',
          '- Follow-ups like "explain step two again": re-explain only that step, more simply, with an example.',
          '- If asked something the policy does not cover, say so instead of guessing.',
          '- You are only teaching. Never say or imply that you approved, rejected or changed any item.',
          '- Under 200 words, plain text.',
        ].join('\n'),
        languageInstruction(language),
        `<policy>\n${formatPolicyChunks(policy)}\n</policy>`,
        `<approval_queue>\n${formatQueue(pending)}\n</approval_queue>`,
      ].join('\n\n'),
    },
    ...history,
    { role: 'user', content: message },
  ],
};

export const TEACH_PROMPT = TEACH_PROMPT_V1;
