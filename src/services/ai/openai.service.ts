import OpenAI, { APIError } from 'openai';
import type { FallbackReason } from '../../schemas/ai.schema';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  /** Ask the model for a JSON object (OpenAI JSON mode). */
  json?: boolean;
}

/** Thin seam over the vendor SDK so services and tests never touch OpenAI directly. */
export interface LlmProvider {
  createCompletion(req: ProviderRequest, signal: AbortSignal): Promise<string>;
  createStream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<string>;
}

export type LlmErrorReason = FallbackReason | 'cancelled';

/** Every provider failure is normalised to one of these before it reaches a service. */
export class LlmError extends Error {
  constructor(
    readonly reason: LlmErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  /** Injected in tests; defaults to the official SDK client. */
  client?: Pick<OpenAI, 'chat'>;
}

export function createOpenAiProvider({ apiKey, model, client }: OpenAiProviderOptions): LlmProvider {
  // Timeouts and retries are owned by LlmService so the 8s budget is enforced in one place.
  const openai = client ?? new OpenAI({ apiKey, maxRetries: 0 });

  return {
    async createCompletion(req, signal) {
      const completion = await openai.chat.completions.create(
        {
          model,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          ...(req.json ? { response_format: { type: 'json_object' as const } } : {}),
        },
        { signal },
      );
      return completion.choices[0]?.message?.content ?? '';
    },

    async *createStream(req, signal) {
      const stream = await openai.chat.completions.create(
        {
          model,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          stream: true,
        },
        { signal },
      );
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
  };
}

export interface LlmTimeouts {
  /** Hard limit for a non-streaming call, and time-to-first-token for a stream. Default 8s. */
  timeoutMs: number;
  /** Max silence between streamed tokens before we treat the stream as stalled. Default 8s. */
  idleTimeoutMs: number;
  /** Absolute cap for a whole streamed answer. */
  maxStreamMs: number;
}

export interface LlmCallOptions extends ProviderRequest {
  /** Aborted when the client disconnects or cancels. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUTS: LlmTimeouts = { timeoutMs: 8_000, idleTimeoutMs: 8_000, maxStreamMs: 30_000 };

/**
 * Wraps a provider with the reliability rules every AI call must follow:
 * timeouts, cancellation, and error normalisation. `provider === null` means no API key.
 */
export class LlmService {
  readonly timeouts: LlmTimeouts;

  constructor(
    private readonly provider: LlmProvider | null,
    timeouts: Partial<LlmTimeouts> = {},
  ) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  }

  get isConfigured() {
    return this.provider !== null;
  }

  async complete({ signal, ...req }: LlmCallOptions): Promise<string> {
    const provider = this.requireProvider();
    const guard = new CallGuard(signal);
    guard.arm(this.timeouts.timeoutMs);
    try {
      return await guard.race(provider.createCompletion(req, guard.signal));
    } catch (err) {
      throw guard.normalize(err);
    } finally {
      guard.dispose();
    }
  }

  async *stream({ signal, ...req }: LlmCallOptions): AsyncGenerator<string> {
    const provider = this.requireProvider();
    const guard = new CallGuard(signal);
    guard.arm(this.timeouts.timeoutMs);
    guard.cap(this.timeouts.maxStreamMs);
    let iterator: AsyncIterator<string> | undefined;
    try {
      iterator = provider.createStream(req, guard.signal)[Symbol.asyncIterator]();
      while (true) {
        const next = await guard.race(iterator.next());
        if (next.done) return;
        guard.arm(this.timeouts.idleTimeoutMs);
        if (next.value) yield next.value;
      }
    } catch (err) {
      throw guard.normalize(err);
    } finally {
      guard.dispose();
      // Best effort: let the SDK close the HTTP stream. Never await a provider that may hang.
      void iterator?.return?.().catch(() => undefined);
    }
  }

  private requireProvider(): LlmProvider {
    if (!this.provider) throw new LlmError('missing_api_key', 'OPENAI_API_KEY is not configured');
    return this.provider;
  }
}

/** Per-call abort/timeout bookkeeping. */
class CallGuard {
  private readonly controller = new AbortController();
  private idleTimer?: NodeJS.Timeout;
  private capTimer?: NodeJS.Timeout;
  private timedOut = false;
  private readonly onExternalAbort = () => this.controller.abort();

  constructor(private readonly external?: AbortSignal) {
    if (external?.aborted) this.controller.abort();
    external?.addEventListener('abort', this.onExternalAbort, { once: true });
  }

  get signal() {
    return this.controller.signal;
  }

  arm(ms: number) {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.timeout(), ms);
  }

  cap(ms: number) {
    this.capTimer = setTimeout(() => this.timeout(), ms);
  }

  /** Resolves with `work`, or rejects as soon as the call is aborted — even if the provider ignores the signal. */
  race<T>(work: Promise<T>): Promise<T> {
    if (this.signal.aborted) return Promise.reject(this.abortError());
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(this.abortError());
      this.signal.addEventListener('abort', onAbort, { once: true });
      work.then(
        (value) => {
          this.signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (err) => {
          this.signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }

  normalize(err: unknown): LlmError {
    if (err instanceof LlmError) return err;
    if (this.timedOut) return new LlmError('timeout', 'The AI provider did not respond in time');
    if (this.external?.aborted) return new LlmError('cancelled', 'Request cancelled');
    if (err instanceof APIError && err.status === 401) {
      return new LlmError('provider_error', 'The AI provider rejected the API key');
    }
    return new LlmError('provider_error', 'The AI provider request failed');
  }

  dispose() {
    clearTimeout(this.idleTimer);
    clearTimeout(this.capTimer);
    this.external?.removeEventListener('abort', this.onExternalAbort);
  }

  private timeout() {
    this.timedOut = true;
    this.controller.abort();
  }

  private abortError() {
    return this.timedOut
      ? new LlmError('timeout', 'The AI provider did not respond in time')
      : new LlmError('cancelled', 'Request cancelled');
  }
}
