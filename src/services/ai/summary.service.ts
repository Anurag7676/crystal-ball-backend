import { SUMMARY_PROMPT } from '../../prompts/summary.prompt';
import type { ApprovalRepository } from '../../repositories/approval.repository';
import {
  type FallbackReason,
  type Summary,
  type SummaryModelOutput,
  SUMMARY_OUTPUT_JSON_SCHEMA,
  SummaryModelOutputSchema,
  type SummaryRequest,
} from '../../schemas/ai.schema';
import type { Approval } from '../../schemas/approval.schema';
import { ORDERING_NOTE, summaryFallback } from '../../utils/fallback';
import { LlmError, type LlmService } from './openai.service';

export interface SummaryResult {
  summary: Summary;
  source: 'ai' | 'fallback';
  fallbackReason?: FallbackReason;
  /** Why the AI output was rejected — for server logs only, never sent to the client. */
  fallbackDetail?: string;
}

/**
 * Deterministic checks on top of the Zod shape: the model must agree with the data we gave it.
 * Returns a reason string when the output can't be trusted.
 */
export function verifySummary(output: SummaryModelOutput, pending: Approval[]): string | null {
  if (output.pendingCount !== pending.length) {
    return `pendingCount ${output.pendingCount} does not match ${pending.length}`;
  }
  const known = new Set(pending.map((a) => a.id));
  const seen = new Set<string>();
  for (const { approvalId } of output.priorityItems) {
    if (!known.has(approvalId)) return `unknown approval id ${approvalId}`;
    if (seen.has(approvalId)) return `duplicate approval id ${approvalId}`;
    seen.add(approvalId);
  }
  return null;
}

function parseModelJson(raw: string): SummaryModelOutput {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new LlmError('invalid_output', 'Model output is not valid JSON');
  }
  const parsed = SummaryModelOutputSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new LlmError('invalid_output', `Model output does not match the summary schema (${issues})`);
  }
  return parsed.data;
}

/**
 * "Present me Summary": needs the LLM for prioritisation and phrasing, but its output is
 * buffered, parsed, schema-validated and cross-checked against the dataset before the UI sees it.
 */
export function createSummaryService({ approvals, llm }: { approvals: ApprovalRepository; llm: LlmService }) {
  return {
    async generate({ language }: SummaryRequest, signal: AbortSignal): Promise<SummaryResult> {
      const all = await approvals.list();
      const pending = all.filter((a) => a.status === 'pending_review');
      const byId = new Map(pending.map((a) => [a.id, a]));
      const prompt = SUMMARY_PROMPT;

      try {
        const raw = await llm.complete({
          messages: prompt.build({ pendingCount: pending.length, pending, language }),
          maxTokens: prompt.maxTokens,
          temperature: prompt.temperature,
          json: true,
          jsonSchema: SUMMARY_OUTPUT_JSON_SCHEMA,
          signal,
        });
        const output = parseModelJson(raw);
        const problem = verifySummary(output, pending);
        if (problem) throw new LlmError('invalid_output', `Summary failed verification: ${problem}`);

        return {
          source: 'ai',
          summary: {
            pendingCount: output.pendingCount,
            overview: output.overview,
            // Titles come from our data, not the model, so a hallucinated title can't reach the UI.
            priorityItems: output.priorityItems.map((p) => ({
              approvalId: p.approvalId,
              title: byId.get(p.approvalId)!.title,
              reason: p.reason,
            })),
            recommendations: output.recommendations,
            orderingNote: ORDERING_NOTE,
          },
        };
      } catch (err) {
        const llmError = err instanceof LlmError ? err : new LlmError('provider_error', 'Unexpected failure');
        if (llmError.reason === 'cancelled') throw llmError;
        return {
          source: 'fallback',
          fallbackReason: llmError.reason,
          fallbackDetail: llmError.message,
          summary: summaryFallback(all),
        };
      }
    },
  };
}
