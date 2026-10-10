import {
  HELP_PROMPT,
  HELP_PROMPT_V1,
  HELP_PROMPT_V2,
  HELP_PROMPT_V3,
  HELP_PROMPT_V4,
} from '../../src/prompts/help.prompt';
import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import { InMemoryConversationRepository } from '../../src/repositories/conversation.repository';
import { createHelpService } from '../../src/services/ai/help.service';
import { LlmService } from '../../src/services/ai/openai.service';
import { loadPolicyChunks } from '../../src/services/rag/policy.service';
import { FakeProvider, textScript } from '../helpers/fakes';

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

async function drain(stream: AsyncIterable<string>) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

function setup(reply = 'Check them first [policy-3].') {
  const provider = new FakeProvider(textScript(reply));
  const conversations = new InMemoryConversationRepository();
  const service = createHelpService({
    approvals: new FixtureApprovalRepository(),
    conversations,
    llm: new LlmService(provider),
    policy: loadPolicyChunks(),
    logger: silent,
  });
  const ask = async (message: string) => {
    const plan = await service.prepare({ sessionId: 'session-1234', message });
    const text = await drain(plan.generate(new AbortController().signal));
    await plan.onComplete?.(text, 'ai');
    return { plan, text, system: provider.calls.at(-1)!.messages[0]!.content };
  };
  return { provider, ask };
}

describe('help prompt', () => {
  it('is versioned; V3 is active and earlier versions stay exported', () => {
    expect(HELP_PROMPT_V1.version).toBe(1);
    expect(HELP_PROMPT_V2.version).toBe(2);
    expect(HELP_PROMPT_V3.version).toBe(3);
    expect(HELP_PROMPT).toBe(HELP_PROMPT_V4);
  });

  it('V3 forbids claiming earlier statements that are not in the conversation', () => {
    const policy = loadPolicyChunks();
    const system = HELP_PROMPT_V3.build({ index: policy, retrieved: [], carried: [], history: [], message: 'x' })[0]!
      .content;

    expect(system).toMatch(/only refer to your earlier answers as they appear in the messages above/i);
    expect(system).toMatch(/never claim you said something that is not there/i);
    // V2's guarantees are kept.
    expect(system).toMatch(/never say that a listed section does not exist/i);
    expect(system).toMatch(/not retrieved for this question/i);
  });

  it('V2 lists every policy section and separates "not included" from "does not exist"', () => {
    const policy = loadPolicyChunks();
    const system = HELP_PROMPT_V2.build({ index: policy, retrieved: [], carried: [], history: [], message: 'x' })[0]!
      .content;

    for (const c of policy) expect(system).toContain(`${c.id} — ${c.heading}`);
    expect(system).toMatch(/never say that a listed section does not exist/i);
    expect(system).toMatch(/not retrieved for this question/i);
    expect(system).toMatch(/do not retract/i);
    expect(system).toMatch(/cite only sections whose text is included/i);
    expect(system).toMatch(/never invent deadlines, time limits/i);
  });
});

describe('help service — multi-turn citation consistency (regression)', () => {
  const Q1 = 'What is the procedure for reviewing safety equipment?';
  const Q2 =
    'Does our approval policy require the site safety lead to approve every safety equipment document within 24 hours?';

  it('documents the root cause: Q2 on its own does not retrieve policy-2', () => {
    const { retrieve } = jest.requireActual('../../src/services/rag/retriever') as typeof import('../../src/services/rag/retriever');
    expect(retrieve(Q2, loadPolicyChunks()).map((c) => c.id)).not.toContain('policy-2');
  });

  it('keeps sections cited in earlier turns available to follow-up questions', async () => {
    const { ask } = setup('Follow the review steps [policy-2] and check safety items first [policy-3].');

    await ask(Q1);
    const second = await ask(Q2);

    expect(second.plan.sources).toEqual(expect.arrayContaining(['policy-3', 'policy-1', 'policy-2']));
    expect(second.system).toContain('[policy-2] Review workflow:');
    expect(second.system).toMatch(/cited earlier in this conversation/i);
    // A citation of policy-2 in the new answer is now verifiable against this request's context.
    expect(second.plan.citedSources?.('See [policy-2].')).toEqual(['policy-2']);
  });

  it('caps the context so carried sections cannot crowd out the current question', async () => {
    const { ask } = setup('[policy-1] [policy-2] [policy-3] [policy-4]');

    await ask(Q1);
    const second = await ask(Q2);

    expect(second.plan.sources!.length).toBeLessThanOrEqual(4);
    expect(second.plan.sources!.slice(0, 2)).toEqual(['policy-3', 'policy-1']); // retrieved first
  });

  it('never stores citations to sections that were not in the request context', async () => {
    const { ask, provider } = setup('Escalate it [policy-3]. Also see [policy-9] and [policy-4].');

    await ask('What if I am unsure about a safety item?'); // retrieves policy-3 (+ one more), never policy-9
    await ask('Thanks');

    const storedReply = provider.calls.at(-1)!.messages.find((m) => m.role === 'assistant')!.content;
    expect(storedReply).toContain('[policy-3]');
    expect(storedReply).not.toContain('[policy-9]');
  });

  it('bases the fallback only on sections retrieved for the current question', async () => {
    const { ask } = setup('Check them first [policy-3].');

    await ask(Q1);
    const offTopic = await ask('What is on the cafeteria menu?');

    expect(offTopic.plan.fallback()).toMatch(/couldn't find a section of the approval policy/);
  });
});

describe('help service (RAG)', () => {
  it('puts only the retrieved policy chunks in the prompt and reports them as sources', async () => {
    const { ask } = setup();

    const { plan, system } = await ask('How should I handle safety equipment and sensor documents?');

    expect(plan.sources?.[0]).toBe('policy-3');
    expect(system).toContain('[policy-3]');
    expect(system).toContain('escalate to the site safety lead');
    const notRetrieved = loadPolicyChunks().filter((c) => !plan.sources?.includes(c.id));
    for (const chunk of notRetrieved) expect(system).not.toContain(chunk.text);
  });

  it('tells the model when nothing relevant was found, so it admits the gap', async () => {
    const { ask } = setup("The approval policy doesn't cover that.");

    const { plan, system } = await ask('What is on the cafeteria menu?');

    expect(plan.sources).toEqual([]);
    expect(system).toContain('No relevant policy sections were found');
  });

  it('only reports citations that point at chunks we actually retrieved', async () => {
    const { ask } = setup('Escalate it [policy-3]. Also see [policy-9] and [policy-3].');

    const { plan, text } = await ask('What if I am unsure about a safety item?');

    expect(plan.citedSources?.(text)).toEqual(['policy-3']);
  });

  it('uses the previous question to retrieve context for a vague follow-up', async () => {
    const { ask } = setup();

    await ask('What video resolution is required?');
    const { plan } = await ask('And what about that?');

    expect(plan.sources).toContain('policy-4');
  });

  it('falls back to the best-matching policy text, or says the answer is unavailable', async () => {
    const { ask } = setup();

    const matched = await ask('Can I review an item I submitted myself?');
    expect(matched.plan.fallback()).toMatch(/^The AI assistant is unavailable/);
    expect(matched.plan.fallback()).toContain('[policy-1]');
    expect(matched.plan.fallback()).toContain('must not review content they submitted themselves');

    const unmatched = await ask('What is on the cafeteria menu?');
    expect(unmatched.plan.fallback()).toMatch(/couldn't find a section of the approval policy/);
  });
});
