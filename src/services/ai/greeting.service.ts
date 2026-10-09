import { GREETING_PROMPT } from '../../prompts/greeting.prompt';
import { type ApprovalRepository, countPending } from '../../repositories/approval.repository';
import type { GreetingRequest } from '../../schemas/ai.schema';
import { greetingFallback } from '../../utils/fallback';
import type { TextStreamPlan } from '../../utils/streaming';
import type { LlmService } from './openai.service';

/**
 * Replay Greeting. Honestly, a template would do ("You have N pending approvals") — the LLM only
 * adds variety and language support. The template is therefore the fallback.
 */
export function createGreetingService({ approvals, llm }: { approvals: ApprovalRepository; llm: LlmService }) {
  return {
    async prepare({ language }: GreetingRequest): Promise<TextStreamPlan> {
      const all = await approvals.list();
      const pending = all.filter((a) => a.status === 'pending_review');
      const pendingCount = countPending(all);
      const prompt = GREETING_PROMPT;

      return {
        generate: (signal) =>
          llm.stream({
            messages: prompt.build({ pendingCount, pending, language }),
            maxTokens: prompt.maxTokens,
            temperature: prompt.temperature,
            signal,
          }),
        fallback: () => greetingFallback(pendingCount),
      };
    },
  };
}
