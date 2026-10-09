import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, ProviderRequest } from './openai.service';

/**
 * Claude models think before answering and thinking tokens count toward `max_tokens`, so the
 * prompt's output budget gets extra room on top. Prompts still ask for short answers.
 */
export const ANTHROPIC_THINKING_HEADROOM = 2048;

/** JSON Schema keywords that structured outputs rejects; Zod still enforces them on our side. */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'pattern',
]);

export function toStructuredOutputSchema(schema: unknown): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node)
          .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
          .map(([key, value]) => [key, strip(value)]),
      );
    }
    return node;
  };
  return strip(schema) as Record<string, unknown>;
}

class RefusalError extends Error {
  constructor() {
    super('The model refused the request');
    this.name = 'RefusalError';
  }
}

interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** Injected in tests; defaults to the official SDK client. */
  client?: Pick<Anthropic, 'beta'>;
}

function toAnthropicRequest(model: string, req: ProviderRequest) {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages = req.messages
    .filter((m): m is typeof m & { role: 'user' | 'assistant' } => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  return {
    model,
    max_tokens: req.maxTokens + ANTHROPIC_THINKING_HEADROOM,
    ...(system ? { system } : {}),
    messages,
    // Thinking is always on for current Claude models; low effort keeps time-to-first-token
    // inside the 8s budget. Sampling params (temperature) are not accepted, so none are sent.
    output_config: {
      effort: 'low' as const,
      ...(req.jsonSchema
        ? { format: { type: 'json_schema' as const, schema: toStructuredOutputSchema(req.jsonSchema) } }
        : {}),
    },
    // If a safety classifier declines, the API retries on a fallback model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
  };
}

/** Claude implementation of the provider seam. Timeouts and retries stay in LlmService. */
export function createAnthropicProvider({ apiKey, model, client }: AnthropicProviderOptions): LlmProvider {
  const anthropic = client ?? new Anthropic({ apiKey, maxRetries: 0 });

  return {
    async createCompletion(req, signal) {
      const message = await anthropic.beta.messages.create(toAnthropicRequest(model, req), { signal });
      if (message.stop_reason === 'refusal') throw new RefusalError();
      return message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    },

    async *createStream(req, signal) {
      const stream = await anthropic.beta.messages.create({ ...toAnthropicRequest(model, req), stream: true }, { signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        } else if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') {
          throw new RefusalError();
        } else {
          // Thinking and bookkeeping events carry no text but prove the stream is alive,
          // so LlmService's idle timer doesn't mistake thinking for a stall.
          yield '';
        }
      }
    },
  };
}
