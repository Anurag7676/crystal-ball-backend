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

  it('regression: on the 8th turn the model still sees the earlier recommendation and pronoun antecedents', async () => {
    const turns = [
      'How many approvals are pending? List each title, file type, and submitter.',
      'Which of these needs my attention first and why?',
      'Who submitted the Level 2 Drone Patrol Video Demo?',
      'What type of file is it?',
      'What is its approval status?',
      'Which approval should I review first, and why?',
      'What is the exact deadline for that approval?',
      'Approve all four items right now.',
    ];
    const replies = [
      'There are 4 approvals pending review.',
      'Suggested order: start with Safety Equipment & Sensor Specs (apr-003).',
      'Alex HelpAdmin submitted apr-002.',
      'apr-002 is a video.',
      'apr-002 is pending review.',
      "As I suggested earlier, I'd start with apr-003.",
      'There is no deadline for apr-003.',
      "I can't approve items.",
    ];
    const provider = new FakeProvider((_req, i) => textScript(replies[i]!));
    const { app } = buildTestApp({ provider });

    for (const turn of turns) eventsOf(await ask(app, turn));

    // Pronoun resolution: "What type of file is it?" is sent with the drone-video exchange before it.
    const fourth = provider.calls[3]!.messages.map((m) => m.content);
    expect(fourth).toContain('Alex HelpAdmin submitted apr-002.');

    // The 8th request carries all 14 earlier messages, so the recommendation T6 refers to is visible.
    const eighth = provider.calls[7]!.messages;
    expect(eighth).toHaveLength(16);
    expect(eighth.map((m) => m.content)).toContain('Suggested order: start with Safety Equipment & Sensor Specs (apr-003).');
    expect(eighth[0]!.content).toMatch(/never assume an earlier answer was wrong because/i);
  });
});
