import { SUMMARY_PROMPT, SUMMARY_PROMPT_V1, SUMMARY_PROMPT_V2 } from '../../src/prompts/summary.prompt';
import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import { SummarySchema } from '../../src/schemas/ai.schema';
import { LlmService } from '../../src/services/ai/openai.service';
import { createSummaryService } from '../../src/services/ai/summary.service';
import { ORDERING_NOTE, summaryFallback } from '../../src/utils/fallback';
import { FakeProvider, jsonScript, textScript, type FakeScript } from '../helpers/fakes';

const validOutput = {
  pendingCount: 4,
  overview: 'Four items are waiting, all submitted on Sep 18.',
  priorityItems: [
    { approvalId: 'apr-003', reason: 'Covers safety equipment.' },
    { approvalId: 'apr-004', reason: 'Camera map affects site layout.' },
  ],
  recommendations: ['Check sensor models against deployed hardware.'],
};

function setup(script: FakeScript | null, timeoutMs?: number) {
  const provider = script === null ? null : new FakeProvider(script);
  const service = createSummaryService({
    approvals: new FixtureApprovalRepository(),
    llm: new LlmService(provider, timeoutMs ? { timeoutMs } : {}),
  });
  return { provider, run: () => service.generate({ sessionId: 'session-1234' }, new AbortController().signal) };
}

describe('summary prompt', () => {
  it('is versioned; V1 stays exported while V2 is active', () => {
    expect(SUMMARY_PROMPT_V1.version).toBe(1);
    expect(SUMMARY_PROMPT).toBe(SUMMARY_PROMPT_V2);
    expect(SUMMARY_PROMPT_V2.version).toBe(2);
  });

  it('V2 bounds the length of every generated field (keeps the call inside the 8s budget)', () => {
    const system = SUMMARY_PROMPT_V2.build({ pendingCount: 0, pending: [] })[0]!.content;
    expect(system).toMatch(/at most 20 words/);
    expect(system).toMatch(/1–2 recommendations/);
    expect(SUMMARY_PROMPT_V2.maxTokens).toBeLessThan(SUMMARY_PROMPT_V1.maxTokens);
  });
});

describe('summary service — AI path', () => {
  it('returns the validated model output enriched with real titles from the dataset', async () => {
    const { provider, run } = setup(jsonScript(validOutput));

    const result = await run();

    expect(result.source).toBe('ai');
    expect(SummarySchema.parse(result.summary)).toEqual({
      pendingCount: 4,
      overview: validOutput.overview,
      priorityItems: [
        { approvalId: 'apr-003', title: 'Safety Equipment & Sensor Specs', reason: 'Covers safety equipment.' },
        { approvalId: 'apr-004', title: '360° Spatial Zone Layout & Camera Map', reason: 'Camera map affects site layout.' },
      ],
      recommendations: validOutput.recommendations,
      orderingNote: ORDERING_NOTE,
    });

    const call = provider!.calls[0]!;
    expect(call.json).toBe(true);
    expect(call.messages.map((m) => m.content).join('\n')).toContain('"id": "apr-003"');
  });
});

describe('summary service — deterministic verification and fallback', () => {
  it.each<[string, FakeScript]>([
    ['malformed JSON', textScript('{"pendingCount": 4, "overview": ')],
    ['prose instead of JSON', textScript('Sure! Here is your summary: four items.')],
    ['missing required fields', jsonScript({ pendingCount: 4, overview: 'x', priorityItems: [{ approvalId: 'apr-001', reason: 'r' }] })],
    ['an approval id that does not exist', jsonScript({ ...validOutput, priorityItems: [{ approvalId: 'apr-999', reason: 'r' }] })],
    ['a duplicated approval id', jsonScript({ ...validOutput, priorityItems: [validOutput.priorityItems[0], validOutput.priorityItems[0]] })],
    ['a wrong pending count', jsonScript({ ...validOutput, pendingCount: 3 })],
    ['an empty response', textScript('')],
  ])('rejects %s and returns the factual fallback', async (_label, script) => {
    const { run } = setup(script);

    const result = await run();

    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toBe('invalid_output');
    expect(result.summary).toEqual(summaryFallback(await new FixtureApprovalRepository().list()));
  });

  it('falls back on timeout', async () => {
    const { run } = setup({ kind: 'hang' }, 30);
    expect(await run()).toMatchObject({ source: 'fallback', fallbackReason: 'timeout' });
  });

  it('falls back when no API key is configured', async () => {
    const { run } = setup(null);
    expect(await run()).toMatchObject({ source: 'fallback', fallbackReason: 'missing_api_key' });
  });
});

describe('summaryFallback', () => {
  it('is a valid summary built only from known data, safety item first', async () => {
    const approvals = await new FixtureApprovalRepository().list();

    const summary = SummarySchema.parse(summaryFallback(approvals));

    expect(summary.pendingCount).toBe(4);
    expect(summary.priorityItems.map((p) => p.approvalId)).toEqual(['apr-003', 'apr-001', 'apr-002', 'apr-004']);
    expect(summary.priorityItems[0]!.reason).toMatch(/policy-3/);
    expect(summary.orderingNote).toBe(ORDERING_NOTE);
    expect(summary.orderingNote).toMatch(/not an official urgency/i);
  });
});
