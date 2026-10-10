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

  it('keeps an earlier-cited section in context for a follow-up that would not retrieve it (regression)', async () => {
    const { app, provider } = buildTestApp({
      script: (_req, i) =>
        i === 0
          ? textScript('Follow the review workflow [policy-2] and review safety items first [policy-3].')
          : textScript('No. The policy sets no 24-hour deadline; unsure safety items are escalated [policy-3]. ' +
              'The review steps still apply [policy-2].'),
    });

    await ask(app, 'What is the procedure for reviewing safety equipment?');
    const events = eventsOf(
      await ask(
        app,
        'Does our approval policy require the site safety lead to approve every safety equipment document within 24 hours?',
      ),
    );

    expect(find(events, 'meta')!.sources).toEqual(expect.arrayContaining(['policy-2', 'policy-3']));
    expect(find(events, 'done')).toEqual({ source: 'ai', citedSources: ['policy-3', 'policy-2'] });
    const secondPrompt = provider!.calls[1]!.messages[0]!.content;
    expect(secondPrompt).toContain('[policy-2] Review workflow:');
  });

  it('sends deduplicated, validated citations: repeats collapse and hallucinated ids are dropped', async () => {
    const { app } = buildTestApp({
      script: textScript('Steps [policy-2]. Safety first [policy-3]. Again [policy-2]. ', 'Also [policy-9] and [policy-3].'),
    });

    const events = eventsOf(await ask(app, 'What is the procedure for reviewing safety equipment?'));

    // Inline text is streamed unchanged; only the done event carries the validated list.
    expect(deltaText(events)).toContain('[policy-9]');
    expect(find(events, 'done')).toEqual({ source: 'ai', citedSources: ['policy-2', 'policy-3'] });
  });

  it('reports an empty citation list when the answer cites nothing', async () => {
    const { app } = buildTestApp({ script: textScript("The approval policy doesn't cover that.") });

    const events = eventsOf(await ask(app, 'What is on the cafeteria menu?'));

    expect(find(events, 'meta')!.sources).toEqual([]);
    expect(find(events, 'done')).toEqual({ source: 'ai', citedSources: [] });
  });

  it('never gives one session the history of another', async () => {
    const { app, provider } = buildTestApp({ script: textScript('Escalate it [policy-3].') });

    await request(app).post('/api/ai/help').send({ sessionId: 'help-session-a1', message: 'Unsure about a safety item?' });
    await request(app).post('/api/ai/help').send({ sessionId: 'help-session-b2', message: 'What video resolution is required?' });

    const second = provider!.calls[1]!.messages;
    expect(second.map((m) => m.role)).toEqual(['system', 'user']);
    expect(JSON.stringify(second)).not.toContain('Unsure about a safety item?');
    // Nothing was cited in session B, so no section is carried over from session A.
    expect(second[0]!.content).not.toContain('Cited earlier in this conversation:');
  });

  describe('whole-policy questions (regression: broad claim from partial context)', () => {
    const ALL = ['policy-1', 'policy-2', 'policy-3', 'policy-4'];
    const fresh = (sessionId: string, message: string, reply: string) => {
      const built = buildTestApp({ script: textScript(reply) });
      return request(built.app)
        .post('/api/ai/help')
        .send({ sessionId, message })
        .expect(200)
        .then((res) => ({ events: eventsOf(res), system: built.provider!.calls[0]!.messages[0]!.content }));
    };

    it.each([
      ['Does the policy require safety lead approval within 24 hours?', 'policy-3'],
      ['Are there any time-related rules in the policy?', undefined],
      ['What happens after 5 working days?', 'policy-4'],
    ])('"%s" gets every policy section, ranked matches first', async (question, firstRanked) => {
      const { events, system } = await fresh('whole-policy-01', question, 'Flag it after 5 working days [policy-4].');

      const sources = find(events, 'meta')!.sources as string[];
      expect([...sources].sort()).toEqual(ALL);
      if (firstRanked) expect(sources[0]).toBe(firstRanked);
      for (const id of ALL) expect(system).toMatch(new RegExp(`\\[${id}\\] [A-Z][^:]+:`));
      expect(system).toContain('All policy sections are included for this question.');
      expect(system).toContain('should be flagged to the operations manager'); // the 5-working-day rule is visible
    });

    it('tells the model a flagging threshold is not an approval deadline and limits whole-policy claims', async () => {
      const { system } = await fresh('whole-policy-02', 'Is there a deadline for approvals?', 'ok');

      expect(system).toMatch(/a flagging threshold .* is not an approval deadline/i);
      expect(system).toMatch(/only say the policy has no .* when all policy sections are included/i);
    });

    it('keeps citations validated and deduplicated for a whole-policy answer', async () => {
      const { events } = await fresh(
        'whole-policy-03',
        'Are there any time-related rules in the policy?',
        'No deadline; undecided items are flagged after 5 working days [policy-4] [policy-4]. Escalate if unsure [policy-3].',
      );

      expect(find(events, 'done')).toEqual({ source: 'ai', citedSources: ['policy-4', 'policy-3'] });
    });

    it('keeps normal top-2 retrieval for a general procedure question', async () => {
      const { events, system } = await fresh('whole-policy-04', 'What is the procedure for reviewing safety equipment?', 'ok');

      expect(find(events, 'meta')!.sources).toEqual(['policy-3', 'policy-2']);
      expect(system).not.toContain('All policy sections are included for this question.');
    });
  });

  it('falls back to the retrieved policy text when the AI times out', async () => {
    const { app } = buildTestApp({ script: { kind: 'hang' }, timeoutMs: 50 });

    const events = eventsOf(await ask(app, 'What should I do if I am unsure about a safety item?'));

    const result = find(events, 'result') as { text: string };
    expect(result.text).toContain('[policy-3]');
    // The fallback quotes a real retrieved section, so its citation is validated and sent too.
    expect(find(events, 'done')).toEqual({ source: 'fallback', fallbackReason: 'timeout', citedSources: ['policy-3'] });
  });
});
