import { APIError } from 'openai';
import { createOpenAiProvider, LlmError, LlmService } from '../../src/services/ai/openai.service';
import { FakeProvider, textScript } from '../helpers/fakes';

const req = { messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 50, temperature: 0 };

async function collect(stream: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

async function reasonOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(LlmError);
    return (err as LlmError).reason;
  }
  throw new Error('expected the call to fail');
}

describe('LlmService', () => {
  afterEach(() => jest.useRealTimers());

  it('defaults to the 8-second timeout required by the assignment', () => {
    expect(new LlmService(null).timeouts.timeoutMs).toBe(8_000);
    expect(new LlmService(null).timeouts.idleTimeoutMs).toBe(8_000);
  });

  it('fails fast with missing_api_key when no provider is configured', async () => {
    const llm = new LlmService(null);
    expect(llm.isConfigured).toBe(false);
    expect(await reasonOf(llm.complete(req))).toBe('missing_api_key');
    expect(await reasonOf(collect(llm.stream(req)))).toBe('missing_api_key');
  });

  it('times out a stalled completion at exactly 8s, even if the provider ignores the abort signal', async () => {
    jest.useFakeTimers();
    const llm = new LlmService(new FakeProvider({ kind: 'hang' }));

    let settled = false;
    const result = reasonOf(llm.complete(req)).finally(() => (settled = true));

    await jest.advanceTimersByTimeAsync(7_999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await result).toBe('timeout');
  });

  it('times out a stream that never produces a first token', async () => {
    const llm = new LlmService(new FakeProvider({ kind: 'hang' }), { timeoutMs: 30 });
    expect(await reasonOf(collect(llm.stream(req)))).toBe('timeout');
  });

  it('times out a stream that stalls between tokens', async () => {
    const provider = new FakeProvider({ kind: 'chunks', chunks: ['a', 'b'], chunkDelayMs: 100 });
    const llm = new LlmService(provider, { timeoutMs: 500, idleTimeoutMs: 30 });
    expect(await reasonOf(collect(llm.stream(req)))).toBe('timeout');
  });

  it('streams chunks through unchanged on the happy path', async () => {
    const llm = new LlmService(new FakeProvider(textScript('Hel', 'lo')));
    expect(await collect(llm.stream(req))).toEqual(['Hel', 'lo']);
  });

  it('normalises provider failures (including a revoked key) to provider_error', async () => {
    const authError = APIError.generate(401, { message: 'bad key' }, 'bad key', new Headers());
    const llm = new LlmService(new FakeProvider({ kind: 'error', error: authError }));
    expect(await reasonOf(llm.complete(req))).toBe('provider_error');

    const crashing = new LlmService(new FakeProvider({ kind: 'error', error: new Error('socket hang up') }));
    expect(await reasonOf(collect(crashing.stream(req)))).toBe('provider_error');
  });

  it('reports cancellation when the caller aborts', async () => {
    const controller = new AbortController();
    const llm = new LlmService(new FakeProvider({ kind: 'hang' }), { timeoutMs: 5_000 });

    const pending = reasonOf(collect(llm.stream({ ...req, signal: controller.signal })));
    controller.abort();

    expect(await pending).toBe('cancelled');
  });
});

describe('createOpenAiProvider (OpenAI SDK mocked)', () => {
  it('sends the configured model, JSON mode and abort signal for completions', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: '{"ok":true}' } }] });
    const provider = createOpenAiProvider({ apiKey: 'k', model: 'gpt-4o', client: { chat: { completions: { create } } } as never });
    const signal = new AbortController().signal;

    const text = await provider.createCompletion({ ...req, json: true }, signal);

    expect(text).toBe('{"ok":true}');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', response_format: { type: 'json_object' }, max_tokens: 50 }),
      { signal },
    );
  });

  it('yields only non-empty content deltas from a streamed response', async () => {
    async function* sdkStream() {
      yield { choices: [{ delta: { role: 'assistant' } }] };
      yield { choices: [{ delta: { content: 'Hi ' } }] };
      yield { choices: [{ delta: { content: 'there' } }] };
      yield { choices: [] };
    }
    const create = jest.fn().mockResolvedValue(sdkStream());
    const provider = createOpenAiProvider({ apiKey: 'k', model: 'gpt-4o', client: { chat: { completions: { create } } } as never });

    expect(await collect(provider.createStream(req, new AbortController().signal))).toEqual(['Hi ', 'there']);
    expect(create.mock.calls[0][0]).toMatchObject({ stream: true, model: 'gpt-4o' });
  });
});
