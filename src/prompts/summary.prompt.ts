import type { Approval } from '../schemas/approval.schema';
import { ASSISTANT_IDENTITY, DATA_SAFETY_RULES, formatQueue, languageInstruction, type PromptDefinition } from './shared';

export interface SummaryContext {
  pendingCount: number;
  pending: Approval[];
  language?: string;
}

export const SUMMARY_PROMPT_V1: PromptDefinition<SummaryContext> = {
  id: 'summary',
  version: 1,
  maxTokens: 700,
  temperature: 0.2,
  build: ({ pendingCount, pending, language }) => [
    {
      role: 'system',
      content: [
        ASSISTANT_IDENTITY,
        DATA_SAFETY_RULES,
        'Task: summarise the pending approvals queue for the operator and suggest a review order.',
        'Return ONLY a JSON object with exactly these keys:',
        '{"pendingCount": number, "overview": string, "priorityItems": [{"approvalId": string, "reason": string}], "recommendations": string[]}',
        [
          'Rules:',
          '- pendingCount must equal the number of items in <approval_queue>.',
          '- priorityItems lists every pending item once, in your suggested review order, using the exact "id" values.',
          '- The queue has no official priority. Base the order only on what the items are (e.g. safety-related content ' +
            'first) and say so in each reason. Never claim an item is urgent, overdue or high-severity.',
          '- overview: 1–2 sentences. recommendations: 1–3 short, practical review tips.',
          '- Write overview, reasons and recommendations in the language below. Keep JSON keys in English.',
        ].join('\n'),
        languageInstruction(language),
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: `pendingCount: ${pendingCount}\n<approval_queue>\n${formatQueue(pending)}\n</approval_queue>`,
    },
  ],
};

export const SUMMARY_PROMPT = SUMMARY_PROMPT_V1;
