import { selectProvider } from '../../src/config/llmProvider';
import {
  ANTHROPIC_THINKING_HEADROOM,
  createAnthropicProvider,
  toStructuredOutputSchema,
} from '../../src/services/ai/anthropic.provider';
import type { ProviderRequest } from '../../src/services/ai/openai.service';

const req: ProviderRequest = {
  messages: [
    { role: 'system', content: 'You are the Approvals assistant.' },
    { role: 'user', content: 'Which first?' },
    { role: 'assistant', content: 'The safety specs.' },
    { role: 'user', content: 'Who submitted it?' },
  ],
  maxTokens: 400,
  temperature: 0.4,
};

async function collect(stream: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

const clientWith = (create: jest.Mock) => ({ beta: { messages: { create } } }) as never;

describe('createAnthropicProvider (Anthropic SDK mocked)', () => {
  it('maps system prompts to `system`, keeps turns in order, and never sends sampling params', async () => {
    const create = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Sam ' },
        { type: 'text', text: 'HelpAdmin.' },
      ],
    });
    const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-opus-5-5', client: clientWith(create) });
    const signal = new AbortController().signal;

    expect(await provider.createCompletion(req, signal)).toBe('Sam HelpAdmin.');

    const [params, options] = create.mock.calls[0];
    expect(options).toEqual({ signal });
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'You are the Approvals assistant.',
      messages: [
        { role: 'user', content: 'Which first?' },
        { role: 'assistant', content: 'The safety specs.' },
        { role: 'user', content: 'Who submitted it?' },
      ],
      max_tokens: 400 + ANTHROPIC_THINKING_HEADROOM,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(params).not.toHaveProperty('temperature');
  });

  it('requests structured JSON with a schema stripped of keywords the API does not support', async () => {
    const create = jest.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
    const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-opus-5-5', client: clientWith(create) });
    const schema = {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 9 }, n: { type: 'integer', minimum: 0 } },
      required: ['name', 'n'],
      additionalProperties: false,
    };

    await provider.createCompletion({ ...req, json: true, jsonSchema: schema }, new AbortController().signal);

    expect(create.mock.calls[0][0].output_config).toEqual({
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { name: { type: 'string' }, n: { type: 'integer' } },
          required: ['name', 'n'],
          additionalProperties: false,
        },
      },
    });
  });

  it('treats a refusal as a failed call (so the deterministic fallback is used)', async () => {
    const create = jest.fn().mockResolvedValue({ stop_reason: 'refusal', content: [] });
    const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-opus-5-5', client: clientWith(create) });

    await expect(provider.createCompletion(req, new AbortController().signal)).rejects.toThrow(/refus/i);
  });

  it('streams text deltas, emitting empty heartbeats while the model is thinking', async () => {
    async function* events() {
      yield { type: 'message_start' };
      yield { type: 'content_block_start', content_block: { type: 'thinking' } };
      yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } };
      yield { type: 'content_block_start', content_block: { type: 'text' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Sam ' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'HelpAdmin.' } };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
    }
    const create = jest.fn().mockResolvedValue(events());
    const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-opus-5-5', client: clientWith(create) });

    const chunks = await collect(provider.createStream(req, new AbortController().signal));

    expect(chunks.join('')).toBe('Sam HelpAdmin.');
    expect(chunks.filter((c) => c === '').length).toBeGreaterThan(0);
    expect(create.mock.calls[0][0]).toMatchObject({ stream: true });
  });

  it('fails a stream that ends in a refusal', async () => {
    async function* events() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Par' } };
      yield { type: 'message_delta', delta: { stop_reason: 'refusal' } };
    }
    const provider = createAnthropicProvider({
      apiKey: 'k',
      model: 'claude-opus-5-5',
      client: clientWith(jest.fn().mockResolvedValue(events())),
    });

    await expect(collect(provider.createStream(req, new AbortController().signal))).rejects.toThrow(/refus/i);
  });
});

describe('toStructuredOutputSchema', () => {
  it('removes unsupported constraints recursively and drops $schema', () => {
    expect(
      toStructuredOutputSchema({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: { type: 'string', maxLength: 10 },
      }),
    ).toEqual({ type: 'array', items: { type: 'string' } });
  });
});

describe('selectProvider', () => {
  const base = { OPENAI_MODEL: 'gpt-4o', ANTHROPIC_MODEL: 'claude-opus-5-5' };

  it('prefers Claude when an Anthropic key is configured', () => {
    expect(selectProvider({ ...base, ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' })).toMatchObject({
      name: 'anthropic',
      model: 'claude-opus-5-5',
    });
  });

  it('uses OpenAI when only an OpenAI key is configured', () => {
    expect(selectProvider({ ...base, OPENAI_API_KEY: 'o' })).toMatchObject({ name: 'openai', model: 'gpt-4o' });
  });

  it('honours an explicit AI_PROVIDER', () => {
    expect(selectProvider({ ...base, AI_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }).name).toBe(
      'openai',
    );
  });

  it('returns no provider (fallback-only mode) without keys', () => {
    expect(selectProvider(base)).toEqual({ name: 'none', model: undefined, provider: null });
  });
});
