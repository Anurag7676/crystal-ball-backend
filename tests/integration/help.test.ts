import request from 'supertest';
import { textScript } from '../helpers/fakes';
import { deltaText, eventsOf, find } from '../helpers/sse';
import { buildTestApp, SESSION_ID } from '../helpers/testApp';

const ask = (app: Parameters<typeof request>[0], message: string) =>
  request(app).post('/api/ai/help').send({ sessionId: SESSION_ID, message }).expect(200);

describe('POST /api/ai/help', () => {
  it('streams a grounded answer with retrieved and verified citations', async () => {
    const { app } = buildTestApp({
      script: textScript('Review safety items first and ', 'escalate if unsure [policy-3].'),
    });

    const events = eventsOf(await ask(app, 'What should I do if I am unsure about a safety item?'));

    expect((find(events, 'meta')!.sources as string[])[0]).toBe('policy-3');
    expect(deltaText(events)).toBe('Review safety items first and escalate if unsure [policy-3].');
    expect(find(events, 'done')).toEqual({ source: 'ai', citedSources: ['policy-3'] });
  });

  it('falls back to the retrieved policy text when the AI times out', async () => {
    const { app } = buildTestApp({ script: { kind: 'hang' }, timeoutMs: 50 });

    const events = eventsOf(await ask(app, 'What should I do if I am unsure about a safety item?'));

    const result = find(events, 'result') as { text: string };
    expect(result.text).toContain('[policy-3]');
    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'timeout' });
  });
});
