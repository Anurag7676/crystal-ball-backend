import type { ChatMessage } from '../services/ai/openai.service';
import type { PolicyChunk } from '../services/rag/policy.service';
import { ASSISTANT_IDENTITY, DATA_SAFETY_RULES, languageInstruction, type PromptDefinition } from './shared';

export interface HelpContext {
  chunks: PolicyChunk[];
  history: ChatMessage[];
  message: string;
  language?: string;
}

export const formatPolicyChunks = (chunks: PolicyChunk[]) =>
  chunks.length === 0
    ? 'No relevant policy sections were found for this question.'
    : chunks.map((c) => `[${c.id}] ${c.heading}: ${c.text}`).join('\n\n');

export const HELP_PROMPT_V1: PromptDefinition<HelpContext> = {
  id: 'help',
  version: 1,
  maxTokens: 450,
  temperature: 0.1,
  build: ({ chunks, history, message, language }) => [
    {
      role: 'system',
      content: [
        ASSISTANT_IDENTITY,
        DATA_SAFETY_RULES,
        [
          'Answer the operator’s operational question using ONLY the policy sections inside <policy>.',
          '- Do not use general knowledge and never invent rules, numbers or roles that are not in the sections.',
          '- If the sections do not answer the question, say: "The approval policy doesn’t cover that." and suggest ' +
            'asking the operations manager.',
          '- Cite the section id in square brackets after each claim it supports, e.g. [policy-2].',
          '- Follow-up questions may refer to earlier turns; still answer only from the sections.',
          '- Under 150 words, plain text.',
        ].join('\n'),
        languageInstruction(language),
        `<policy>\n${formatPolicyChunks(chunks)}\n</policy>`,
      ].join('\n\n'),
    },
    ...history,
    { role: 'user', content: message },
  ],
};

export const HELP_PROMPT = HELP_PROMPT_V1;
