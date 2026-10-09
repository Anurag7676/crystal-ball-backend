import request from 'supertest';
import { FakeProvider, textScript } from '../helpers/fakes';
import { deltaText, eventsOf, find, names } from '../helpers/sse';
import { buildTestApp, SESSION_ID } from '../helpers/testApp';

const ask = (app: Parameters<typeof request>[0], message: string, sessionId = SESSION_ID) =>
  request(app).post('/api/ai/chat').send({ sessionId, message }).expect(200);

describe('POST /api/ai/chat', () => {
  it('streams a multi-turn conversation and remembers earlier turns per session', async () => {
    const provider = new FakeProvider((_req, i) =>
      i === 0
        ? textScript('You may want to start with ', 'Safety Equipment & Sensor Specs.')
        : textScript('Sam HelpAdmin.'),
    );
    const { app } = buildTestApp({ provider });

    const first = eventsOf(await ask(app, 'Which approval should I review first?'));
    expect(deltaText(first)).toBe('You may want to start with Safety Equipment & Sensor Specs.');
    expect(find(first, 'done')).toEqual({ source: 'ai' });

    const second = eventsOf(await ask(app, 'Who submitted it?'));
    expect(deltaText(second)).toBe('Sam HelpAdmin.');
    const sentHistory = provider.calls[1]!.messages.map((m) => m.content);
    expect(sentHistory).toContain('You may want to start with Safety Equipment & Sensor Specs.');
  });

  it('keeps sessions isolated', async () => {
    const provider = new FakeProvider(textScript('ok'));
    const { app } = buildTestApp({ provider });

    await ask(app, 'secret question from A', 'session-aaaa');
    await ask(app, 'hello from B', 'session-bbbb');

    const bMessages = provider.calls[1]!.messages.map((m) => m.content).join('\n');
    expect(bMessages).not.toContain('secret question from A');
  });

  it('returns a retryable error (not a guess) when the AI fails on an open question', async () => {
    const { app } = buildTestApp({ script: { kind: 'hang' }, timeoutMs: 50 });

    const events = eventsOf(await ask(app, 'Which approval should I review first?'));

    expect(names(events)).toEqual(['meta', 'error']);
    expect(find(events, 'error')).toEqual({
      code: 'ai_unavailable',
      message: 'The AI assistant took too long to respond. Please try again.',
      retryable: true,
    });
  });

  it('answers from data when the AI fails on a question the dataset can answer', async () => {
    const { app } = buildTestApp({ provider: null });

    const events = eventsOf(await ask(app, 'How many approvals are pending?'));

    expect(find(events, 'result')).toEqual({ kind: 'text', text: 'There are 4 approvals pending review.' });
    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'missing_api_key' });
  });
});
