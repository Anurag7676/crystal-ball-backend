import { TEACH_PROMPT, TEACH_PROMPT_V1 } from '../../src/prompts/teach.prompt';
import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import { InMemoryConversationRepository } from '../../src/repositories/conversation.repository';
import { LlmService } from '../../src/services/ai/openai.service';
import { createTeachService } from '../../src/services/ai/teach.service';
import { loadPolicyChunks } from '../../src/services/rag/policy.service';
import { teachFallback } from '../../src/utils/fallback';
import { FakeProvider, textScript } from '../helpers/fakes';

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const LESSON = '1. Open the item [policy-2]\n2. Check it is complete [policy-2]';

async function drain(stream: AsyncIterable<string>) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

function setup() {
  const provider = new FakeProvider(textScript(LESSON));
  const service = createTeachService({
    approvals: new FixtureApprovalRepository(),
    conversations: new InMemoryConversationRepository(),
    llm: new LlmService(provider),
    policy: loadPolicyChunks(),
    logger: silent,
  });
  const ask = async (message: string) => {
    const plan = await service.prepare({ sessionId: 'session-1234', message });
    const text = await drain(plan.generate(new AbortController().signal));
    await plan.onComplete?.(text, 'ai');
    return plan;
  };
  return { provider, ask };
}

describe('teach prompt', () => {
  it('is versioned', () => {
    expect(TEACH_PROMPT).toBe(TEACH_PROMPT_V1);
  });
});

describe('teach service', () => {
  it('teaches from the whole mock policy and tells the model not to claim actions', async () => {
    const { provider, ask } = setup();

    const plan = await ask('Teach me how to review an approval.');

    const system = provider.calls[0]!.messages[0]!.content;
    expect(plan.sources).toEqual(['policy-1', 'policy-2', 'policy-3', 'policy-4']);
    for (const id of plan.sources!) expect(system).toContain(`[${id}]`);
    expect(system).toMatch(/step by step/i);
    expect(system).toMatch(/never say or imply that you approved, rejected/i);
  });

  it('keeps the lesson in context so "explain step two again" works', async () => {
    const { provider, ask } = setup();

    await ask('Teach me how to review an approval.');
    await ask('Explain step two again, more simply.');

    const followUp = provider.calls[1]!.messages.slice(1);
    expect(followUp).toEqual([
      { role: 'user', content: 'Teach me how to review an approval.' },
      { role: 'assistant', content: LESSON },
      { role: 'user', content: 'Explain step two again, more simply.' },
    ]);
  });
});

describe('teachFallback', () => {
  it('lists the review steps verbatim from the policy, with the source', () => {
    const text = teachFallback(loadPolicyChunks())!;

    expect(text).toMatch(/^The AI tutor is unavailable/);
    expect(text).toContain('[policy-2]');
    expect(text).toContain('1. Open the item and confirm the title, type and submitter match the queue entry.');
    expect(text).toContain('4. Record a decision of Approve or Reject.');
  });

  it('offers no fallback when the policy has no step-by-step section to teach from', () => {
    expect(teachFallback([{ id: 'policy-1', heading: 'Scope', text: 'No steps here.' }])).toBeNull();
  });
});
