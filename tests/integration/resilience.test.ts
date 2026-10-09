import request from 'supertest';
import { ErrorResponseSchema } from '../../src/schemas/ai.schema';
import { eventsOf, find, names } from '../helpers/sse';
import { buildTestApp, SESSION_ID } from '../helpers/testApp';

const bodies = {
  greeting: { sessionId: SESSION_ID },
  summary: { sessionId: SESSION_ID },
  chat: { sessionId: SESSION_ID, message: 'How many approvals are pending?' },
  help: { sessionId: SESSION_ID, message: 'What video resolution is required?' },
  teach: { sessionId: SESSION_ID, message: 'Teach me how to review an approval.' },
} as const;

describe('rate limiting', () => {
  it('limits AI calls per session with a JSON 429 and does not call the LLM', async () => {
    const { app, provider } = buildTestApp({ rateLimits: { ipPerMinute: 100, sessionPerMinute: 2 } });

    await request(app).post('/api/ai/greeting').send({ sessionId: SESSION_ID }).expect(200);
    await request(app).post('/api/ai/greeting').send({ sessionId: SESSION_ID }).expect(200);
    const limited = await request(app).post('/api/ai/greeting').send({ sessionId: SESSION_ID }).expect(429);

    expect(ErrorResponseSchema.parse(limited.body).error.code).toBe('rate_limited');
    expect(provider?.calls).toHaveLength(2);
    // A different session still has its own budget.
    await request(app).post('/api/ai/greeting').send({ sessionId: 'another-session-01' }).expect(200);
  });

  it('caps a client that rotates session ids with the per-IP limit', async () => {
    const { app } = buildTestApp({ rateLimits: { ipPerMinute: 3, sessionPerMinute: 100 } });

    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/ai/greeting').send({ sessionId: `rotating-session-${i}` }).expect(200);
    }
    await request(app).post('/api/ai/greeting').send({ sessionId: 'rotating-session-9' }).expect(429);
  });

  it('does not rate-limit the non-AI approvals endpoint', async () => {
    const { app } = buildTestApp({ rateLimits: { ipPerMinute: 1, sessionPerMinute: 1 } });
    for (let i = 0; i < 5; i++) await request(app).get('/api/approvals').expect(200);
  });
});

describe('missing OPENAI_API_KEY', () => {
  it.each(Object.entries(bodies))('POST /api/ai/%s still answers with a labelled fallback (never a 500)', async (action, body) => {
    const { app } = buildTestApp({ provider: null });

    const res = await request(app).post(`/api/ai/${action}`).send(body).expect(200);
    const events = eventsOf(res);

    expect(names(events)).toEqual(['meta', 'result', 'done']);
    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'missing_api_key' });
  });

  it('reports the degraded mode on the health endpoint', async () => {
    const { app } = buildTestApp({ provider: null });
    expect((await request(app).get('/api/health').expect(200)).body).toEqual({ status: 'ok', ai: 'fallback-only' });
  });
});

describe('stalled provider', () => {
  it.each(Object.entries(bodies))('POST /api/ai/%s finishes the stream instead of hanging', async (action, body) => {
    const { app } = buildTestApp({ script: { kind: 'hang' }, timeoutMs: 50 });

    const events = eventsOf(await request(app).post(`/api/ai/${action}`).send(body).expect(200));

    expect(['done', 'error']).toContain(names(events).at(-1));
  });
});
