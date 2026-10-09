import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AiAction, FallbackReason, SseEventName, SseEventPayload } from '../schemas/ai.schema';
import { LlmError } from '../services/ai/openai.service';
import type { Logger } from './logger';

/** Minimal Server-Sent Events writer over a POST response. */
export class SseStream {
  private ended = false;

  constructor(private readonly res: Response) {}

  open() {
    this.res.status(200);
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    this.res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx)
    this.res.flushHeaders();
  }

  send<E extends SseEventName>(event: E, payload: SseEventPayload<E>) {
    if (this.ended || this.res.writableEnded) return;
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    if (!this.res.writableEnded) this.res.end();
  }
}

/** Aborts when the client disconnects before we finished writing. */
export function abortOnDisconnect(res: Response): AbortController {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller;
}

/** Everything a text-producing AI action needs to stream, decided by its service. */
export interface TextStreamPlan {
  /** Deterministic context ids sent in `meta` (e.g. retrieved policy chunks). */
  sources?: string[];
  generate(signal: AbortSignal): AsyncIterable<string>;
  /** Deterministic replacement text, or null when no safe fallback exists. */
  fallback(): string | null;
  /** Lightweight post-check of the final AI text: returns cited chunk ids that were really retrieved. */
  citedSources?(text: string): string[];
  /** Persist the turn (history). Failures here are logged, never surfaced. */
  onComplete?(reply: string, source: 'ai' | 'fallback'): Promise<void>;
}

const UNAVAILABLE_MESSAGES: Record<FallbackReason, string> = {
  timeout: 'The AI assistant took too long to respond. Please try again.',
  provider_error: 'The AI assistant is temporarily unavailable. Please try again.',
  missing_api_key: 'The AI assistant is not configured on the server.',
  invalid_output: 'The AI assistant returned an unexpected response. Please try again.',
};

/**
 * Streams model tokens as `delta` events. If the model fails at any point — before the first
 * token or midway — the deterministic fallback is sent as a `result` that replaces the partial
 * text, or a retryable `error` if no safe fallback exists. Never throws, never leaves the
 * client hanging.
 */
export async function streamText(
  res: Response,
  { action, plan, logger }: { action: AiAction; plan: TextStreamPlan; logger: Logger },
): Promise<void> {
  const sse = new SseStream(res);
  const cancel = abortOnDisconnect(res);
  sse.open();
  sse.send('meta', { action, requestId: randomUUID(), ...(plan.sources ? { sources: plan.sources } : {}) });

  let text = '';
  try {
    for await (const delta of plan.generate(cancel.signal)) {
      text += delta;
      sse.send('delta', { text: delta });
    }
    if (!text.trim()) throw new LlmError('invalid_output', 'Model returned an empty response');

    const cited = plan.citedSources?.(text);
    sse.send('done', { source: 'ai', ...(cited ? { citedSources: cited } : {}) });
    await persist(plan, text, 'ai', logger);
  } catch (err) {
    const llmError = err instanceof LlmError ? err : new LlmError('provider_error', 'Unexpected failure');
    if (!(err instanceof LlmError)) {
      logger.error('Unexpected error while streaming', { action, error: err instanceof Error ? err.message : String(err) });
    }
    if (llmError.reason === 'cancelled') return; // client is gone; nothing to send

    logger.warn('AI call failed, using fallback', { action, reason: llmError.reason });
    const reason = llmError.reason;
    const fallback = plan.fallback();
    if (fallback) {
      sse.send('result', { kind: 'text', text: fallback });
      // Fallbacks quote real sections, so their citations go through the same validation.
      const cited = plan.citedSources?.(fallback);
      sse.send('done', { source: 'fallback', fallbackReason: reason, ...(cited ? { citedSources: cited } : {}) });
      await persist(plan, fallback, 'fallback', logger);
    } else {
      sse.send('error', { code: 'ai_unavailable', message: UNAVAILABLE_MESSAGES[reason], retryable: true });
    }
  } finally {
    sse.end();
  }
}

/**
 * For structured output: nothing is streamed until the whole model response has been parsed and
 * verified, then exactly one `result` is sent. Partial JSON never reaches the client.
 */
export async function streamStructured(
  res: Response,
  {
    action,
    logger,
    run,
  }: {
    action: AiAction;
    logger: Logger;
    run: (signal: AbortSignal) => Promise<{
      result: SseEventPayload<'result'>;
      source: 'ai' | 'fallback';
      fallbackReason?: FallbackReason;
      /** Server-log-only explanation of why the AI output was rejected. */
      fallbackDetail?: string;
    }>;
  },
): Promise<void> {
  const sse = new SseStream(res);
  const cancel = abortOnDisconnect(res);
  sse.open();
  sse.send('meta', { action, requestId: randomUUID() });
  try {
    const { result, source, fallbackReason, fallbackDetail } = await run(cancel.signal);
    if (source === 'fallback') {
      logger.warn('AI call failed, using fallback', { action, reason: fallbackReason, detail: fallbackDetail });
    }
    sse.send('result', result);
    sse.send('done', { source, ...(fallbackReason ? { fallbackReason } : {}) });
  } catch (err) {
    if (err instanceof LlmError && err.reason === 'cancelled') return;
    logger.error('Unexpected error in structured AI action', {
      action,
      error: err instanceof Error ? err.message : String(err),
    });
    sse.send('error', { code: 'internal_error', message: 'Something went wrong. Please try again.', retryable: true });
  } finally {
    sse.end();
  }
}

async function persist(plan: TextStreamPlan, reply: string, source: 'ai' | 'fallback', logger: Logger) {
  try {
    await plan.onComplete?.(reply, source);
  } catch (err) {
    logger.warn('Could not persist conversation turn', { error: err instanceof Error ? err.name : 'UnknownError' });
  }
}
