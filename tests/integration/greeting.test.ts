import request from 'supertest';
import { FakeProvider, textScript } from '../helpers/fakes';
import { deltaText, eventsOf, find, names } from '../helpers/sse';
import { buildTestApp, SESSION_ID } from '../helpers/testApp';

const post = (app: Parameters<typeof request>[0], body: object = { sessionId: SESSION_ID }) =>
  request(app).post('/api/ai/greeting').send(body);

describe('POST /api/ai/greeting', () => {
  it('streams a fresh GPT greeting token-by-token over SSE', async () => {
    const { app } = buildTestApp({ script: textScript('Welcome back! ', 'You have 4 approvals ', 'waiting.') });

    const res = await post(app).expect(200);

    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = eventsOf(res);
    expect(names(events)).toEqual(['meta', 'delta', 'delta', 'delta', 'done']);
    expect(find(events, 'meta')).toMatchObject({ action: 'greeting' });
    expect(deltaText(events)).toBe('Welcome back! You have 4 approvals waiting.');
    expect(find(events, 'done')).toEqual({ source: 'ai' });
  });

  it('makes a new LLM call on every click instead of replaying a stored greeting', async () => {
    const { app, provider } = buildTestApp({ script: textScript('Hi') });

    await post(app).expect(200);
    await post(app).expect(200);

    expect(provider?.calls).toHaveLength(2);
  });

  it('falls back to a deterministic greeting with the real count when GPT-4o times out', async () => {
    const { app } = buildTestApp({ script: { kind: 'hang' }, timeoutMs: 50 });

    const started = Date.now();
    const events = eventsOf(await post(app).expect(200));

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(find(events, 'result')).toEqual({ kind: 'text', text: 'Welcome back. You have 4 pending approvals.' });
    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'timeout' });
  });

  it('falls back when OPENAI_API_KEY is missing', async () => {
    const { app } = buildTestApp({ provider: null });

    const events = eventsOf(await post(app).expect(200));

    expect(names(events)).toEqual(['meta', 'result', 'done']);
    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'missing_api_key' });
  });

  it('replaces a half-streamed greeting with the fallback if the provider dies mid-stream', async () => {
    const provider = new FakeProvider({ kind: 'fail-after', chunks: ['Welcome '], error: new Error('ECONNRESET') });
    const { app } = buildTestApp({ provider });

    const events = eventsOf(await post(app).expect(200));

    expect(names(events)).toEqual(['meta', 'delta', 'result', 'done']);
    expect(find(events, 'result')).toEqual({ kind: 'text', text: 'Welcome back. You have 4 pending approvals.' });
    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'provider_error' });
  });
});
