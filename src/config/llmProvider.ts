import { createAnthropicProvider } from '../services/ai/anthropic.provider';
import { createOpenAiProvider, type LlmProvider } from '../services/ai/openai.service';

interface ProviderEnv {
  AI_PROVIDER?: 'anthropic' | 'openai';
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
}

export type ProviderSelection =
  | { name: 'anthropic' | 'openai'; model: string; provider: LlmProvider }
  | { name: 'none'; model: undefined; provider: null };

/**
 * Picks the LLM provider from configuration: an explicit AI_PROVIDER wins, otherwise Claude
 * when an Anthropic key is present, then OpenAI. No key at all means fallback-only mode.
 */
export function selectProvider(env: ProviderEnv): ProviderSelection {
  const wantsAnthropic = env.AI_PROVIDER ? env.AI_PROVIDER === 'anthropic' : Boolean(env.ANTHROPIC_API_KEY);

  if (wantsAnthropic && env.ANTHROPIC_API_KEY) {
    return {
      name: 'anthropic',
      model: env.ANTHROPIC_MODEL,
      provider: createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL }),
    };
  }
  if (env.OPENAI_API_KEY && env.AI_PROVIDER !== 'anthropic') {
    return {
      name: 'openai',
      model: env.OPENAI_MODEL,
      provider: createOpenAiProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }),
    };
  }
  return { name: 'none', model: undefined, provider: null };
}
