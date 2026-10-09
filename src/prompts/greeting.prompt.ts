import type { Approval } from '../schemas/approval.schema';
import { ASSISTANT_IDENTITY, languageInstruction, type PromptDefinition } from './shared';

export interface GreetingContext {
  pendingCount: number;
  pending: Approval[];
  language?: string;
}

export const GREETING_PROMPT_V1: PromptDefinition<GreetingContext> = {
  id: 'greeting',
  version: 1,
  maxTokens: 100,
  // Higher temperature: each "Replay Greeting" click should read a little differently.
  temperature: 0.9,
  build: ({ pendingCount, pending, language }) => [
    {
      role: 'system',
      content: [
        ASSISTANT_IDENTITY,
        'Write a short, friendly greeting for an operator who just opened the Approvals panel.',
        'Rules: at most 2 sentences and 40 words; state the pending count exactly as given; you may offer a quick ' +
          'summary of the queue; do not invent deadlines, priorities or names; plain text, no markdown.',
        languageInstruction(language),
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        `pendingCount: ${pendingCount}`,
        `pendingTypes: ${[...new Set(pending.map((a) => a.type))].join(', ') || 'none'}`,
        'Write the greeting now.',
      ].join('\n'),
    },
  ],
};

export const GREETING_PROMPT = GREETING_PROMPT_V1;
