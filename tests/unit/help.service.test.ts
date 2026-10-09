import { HELP_PROMPT, HELP_PROMPT_V1 } from '../../src/prompts/help.prompt';
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
  it('is versioned', () => {
    expect(HELP_PROMPT).toBe(HELP_PROMPT_V1);
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
    for (const chunk of notRetrieved) expect(system).not.toContain(`[${chunk.id}]`);
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
