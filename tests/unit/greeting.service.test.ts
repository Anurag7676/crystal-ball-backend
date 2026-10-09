import { GREETING_PROMPT, GREETING_PROMPT_V1 } from '../../src/prompts/greeting.prompt';
import type { ApprovalRepository } from '../../src/repositories/approval.repository';
import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import type { Approval } from '../../src/schemas/approval.schema';
import { createGreetingService } from '../../src/services/ai/greeting.service';
import { LlmService } from '../../src/services/ai/openai.service';
import { greetingFallback } from '../../src/utils/fallback';
import { FakeProvider, textScript } from '../helpers/fakes';

const repoOf = (approvals: Approval[]): ApprovalRepository => ({ source: 'fixture', list: async () => approvals });

async function drain(stream: AsyncIterable<string>) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

describe('greeting prompt', () => {
  it('is a versioned export, and the active prompt points at a version', () => {
    expect(GREETING_PROMPT_V1.version).toBe(1);
    expect(GREETING_PROMPT).toBe(GREETING_PROMPT_V1);
  });
});

describe('greeting service', () => {
  it('sends GPT-4o the live pending count and the operator language', async () => {
    const provider = new FakeProvider(textScript('Hola, tienes 4 aprobaciones.'));
    const service = createGreetingService({ approvals: new FixtureApprovalRepository(), llm: new LlmService(provider) });

    const plan = await service.prepare({ sessionId: 'session-1234', language: 'es' });
    const text = await drain(plan.generate(new AbortController().signal));

    expect(text).toBe('Hola, tienes 4 aprobaciones.');
    expect(provider.calls).toHaveLength(1);
    const prompt = provider.calls[0]!.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('pendingCount: 4');
    expect(prompt).toContain('"es"');
  });

  it('counts only pending items', async () => {
    const [first, second] = await new FixtureApprovalRepository().list();
    const approvals = [first!, { ...second!, status: 'approved' as const }];
    const provider = new FakeProvider(textScript('hi'));
    const service = createGreetingService({ approvals: repoOf(approvals), llm: new LlmService(provider) });

    const plan = await service.prepare({ sessionId: 'session-1234' });
    await drain(plan.generate(new AbortController().signal));

    expect(provider.calls[0]!.messages.map((m) => m.content).join('\n')).toContain('pendingCount: 1');
    expect(plan.fallback()).toBe('Welcome back. You have 1 pending approval.');
  });

  it('has a deterministic fallback computed from the real dataset', () => {
    expect(greetingFallback(4)).toBe('Welcome back. You have 4 pending approvals.');
    expect(greetingFallback(0)).toBe('Welcome back. You have no pending approvals.');
  });
});
