import request from 'supertest';
import { textScript } from '../helpers/fakes';
import { deltaText, eventsOf, find, names } from '../helpers/sse';
import { buildTestApp, SESSION_ID } from '../helpers/testApp';

const ask = (app: Parameters<typeof request>[0], message: string) =>
  request(app).post('/api/ai/teach').send({ sessionId: SESSION_ID, message }).expect(200);

describe('POST /api/ai/teach', () => {
  it('streams a step-by-step lesson with verified citations', async () => {
    const { app } = buildTestApp({ script: textScript('Step 1: open the item [policy-2].', ' Step 2: check it.') });

    const events = eventsOf(await ask(app, 'Teach me how to review an approval.'));

    expect(names(events)).toEqual(['meta', 'delta', 'delta', 'done']);
    expect(deltaText(events)).toBe('Step 1: open the item [policy-2]. Step 2: check it.');
    expect(find(events, 'done')).toEqual({ source: 'ai', citedSources: ['policy-2'] });
  });

  it('falls back to the policy steps when the provider fails', async () => {
    const { app } = buildTestApp({ script: { kind: 'error', error: new Error('upstream 500') } });

    const events = eventsOf(await ask(app, 'Teach me how to review an approval.'));

    expect((find(events, 'result') as { text: string }).text).toContain('1. Open the item');
    expect(find(events, 'done')).toEqual({
      source: 'fallback',
      fallbackReason: 'provider_error',
      citedSources: ['policy-2'],
    });
  });
});
