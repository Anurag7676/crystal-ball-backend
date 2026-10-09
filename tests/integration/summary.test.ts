import request from 'supertest';
import { jsonScript, textScript } from '../helpers/fakes';
import { eventsOf, find, names } from '../helpers/sse';
import { buildTestApp, SESSION_ID } from '../helpers/testApp';

const validOutput = {
  pendingCount: 4,
  overview: 'Four items await review.',
  priorityItems: [{ approvalId: 'apr-003', reason: 'Safety-related.' }],
  recommendations: ['Verify sensor models.'],
};

const post = (app: Parameters<typeof request>[0]) =>
  request(app).post('/api/ai/summary').send({ sessionId: SESSION_ID }).expect(200);

describe('POST /api/ai/summary', () => {
  it('buffers the model JSON and emits one validated summary result — never partial JSON', async () => {
    const { app } = buildTestApp({ script: jsonScript(validOutput) });

    const events = eventsOf(await post(app));

    expect(names(events)).toEqual(['meta', 'result', 'done']);
    expect(find(events, 'result')).toMatchObject({
      kind: 'summary',
      summary: { pendingCount: 4, priorityItems: [{ approvalId: 'apr-003', title: 'Safety Equipment & Sensor Specs' }] },
    });
    expect(find(events, 'done')).toEqual({ source: 'ai' });
  });

  it('never forwards a broken AI response shape to the UI', async () => {
    const { app } = buildTestApp({ script: textScript('{"pendingCount":4,"overview":"cut off') });

    const events = eventsOf(await post(app));

    const result = find(events, 'result') as { summary: { priorityItems: { approvalId: string }[] } };
    expect(result.summary.priorityItems.map((p) => p.approvalId)).toEqual(['apr-003', 'apr-001', 'apr-002', 'apr-004']);
    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'invalid_output' });
  });

  it('degrades to the factual summary on timeout instead of a 500', async () => {
    const { app } = buildTestApp({ script: { kind: 'hang' }, timeoutMs: 50 });

    const events = eventsOf(await post(app));

    expect(names(events)).toEqual(['meta', 'result', 'done']);
    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'timeout' });
  });

  it('degrades when the provider errors', async () => {
    const { app } = buildTestApp({ script: { kind: 'error', error: new Error('503 from upstream') } });

    const events = eventsOf(await post(app));

    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'provider_error' });
  });
});
