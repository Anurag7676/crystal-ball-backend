import type { LlmProvider, ProviderRequest } from '../../src/services/ai/openai.service';

/** How the fake provider should behave for one call. */
export type FakeScript =
  | { kind: 'chunks'; chunks: string[]; chunkDelayMs?: number }
  /** Never resolves and ignores the abort signal — simulates a stalled upstream. */
  | { kind: 'hang' }
  | { kind: 'error'; error: unknown }
  /** Streams some chunks, then throws. */
  | { kind: 'fail-after'; chunks: string[]; error: unknown };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Test double for the OpenAI provider. Records every request so tests can assert on the
 * prompt/context we actually send, without spending API credits.
 */
export class FakeProvider implements LlmProvider {
  readonly calls: ProviderRequest[] = [];

  constructor(private script: FakeScript | ((req: ProviderRequest, callIndex: number) => FakeScript)) {}

  setScript(script: FakeScript | ((req: ProviderRequest, callIndex: number) => FakeScript)) {
    this.script = script;
  }

  private next(req: ProviderRequest): FakeScript {
    this.calls.push(req);
    return typeof this.script === 'function' ? this.script(req, this.calls.length - 1) : this.script;
  }

  async createCompletion(req: ProviderRequest): Promise<string> {
    const script = this.next(req);
    switch (script.kind) {
      case 'chunks':
        if (script.chunkDelayMs) await sleep(script.chunkDelayMs);
        return script.chunks.join('');
      case 'hang':
        return new Promise<string>(() => undefined);
      case 'error':
      case 'fail-after':
        throw script.error;
    }
  }

  async *createStream(req: ProviderRequest): AsyncIterable<string> {
    const script = this.next(req);
    if (script.kind === 'hang') {
      await new Promise<never>(() => undefined);
      return;
    }
    if (script.kind === 'error') throw script.error;
    for (const chunk of script.chunks) {
      if (script.kind === 'chunks' && script.chunkDelayMs) await sleep(script.chunkDelayMs);
      yield chunk;
    }
    if (script.kind === 'fail-after') throw script.error;
  }
}

export const textScript = (...chunks: string[]): FakeScript => ({ kind: 'chunks', chunks });
export const jsonScript = (value: unknown): FakeScript => ({ kind: 'chunks', chunks: [JSON.stringify(value)] });
