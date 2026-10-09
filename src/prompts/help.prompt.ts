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

export interface HelpContextV2 {
  /** Every section of the policy (ids + headings only), so the model knows what exists. */
  index: Pick<PolicyChunk, 'id' | 'heading'>[];
  /** Sections retrieved for the current question. */
  retrieved: PolicyChunk[];
  /** Sections cited in earlier answers of this conversation, re-included for follow-ups. */
  carried: PolicyChunk[];
  history: ChatMessage[];
  message: string;
  language?: string;
}

const formatSections = (chunks: PolicyChunk[]) => chunks.map((c) => `[${c.id}] ${c.heading}: ${c.text}`).join('\n\n');

/**
 * V2 fixes a multi-turn failure: V1 only showed the sections retrieved for the current question,
 * so when a follow-up's retrieval omitted a section the previous answer had cited, the model
 * concluded that section did not exist and retracted. V2 lists the full section index, re-includes
 * sections cited earlier, and separates "not included here" from "does not exist".
 */
export const HELP_PROMPT_V2: PromptDefinition<HelpContextV2> = {
  id: 'help',
  version: 2,
  maxTokens: 450,
  temperature: 0.1,
  build: ({ index, retrieved, carried, history, message, language }) => [
    {
      role: 'system',
      content: [
        ASSISTANT_IDENTITY,
        DATA_SAFETY_RULES,
        `The approval policy has exactly these sections:\n${index.map((s) => `- ${s.id} — ${s.heading}`).join('\n')}`,
        [
          'Answer the operator’s operational question using ONLY the section text inside <policy>.',
          '- <policy> contains the sections retrieved for this question plus sections cited earlier in this ' +
            'conversation. Other listed sections exist but their text is not included in this request.',
          '- Never say that a listed section does not exist. If answering needs a section whose text is not ' +
            'included, say it was not retrieved for this question instead of guessing what it says.',
          '- Do not retract or contradict an earlier answer unless the included text actually contradicts it.',
          '- Cite only sections whose text is included in <policy>, in square brackets after each claim it ' +
            'supports, e.g. [policy-N].',
          '- Never invent deadlines, time limits, numbers, roles, or approval requirements (who must approve ' +
            'what). If the question assumes one that the included text does not state, say the policy does not state it.',
          '- If the included sections do not answer the question, say: "The approval policy doesn’t cover that." ' +
            'and suggest asking the operations manager.',
          '- Under 150 words, plain text.',
        ].join('\n'),
        languageInstruction(language),
        [
          '<policy>',
          retrieved.length
            ? `Retrieved for this question:\n${formatSections(retrieved)}`
            : 'No relevant policy sections were found for this question.',
          ...(carried.length ? [`Cited earlier in this conversation:\n${formatSections(carried)}`] : []),
          '</policy>',
        ].join('\n\n'),
      ].join('\n\n'),
    },
    ...history,
    { role: 'user', content: message },
  ],
};

export const HELP_PROMPT = HELP_PROMPT_V2;
