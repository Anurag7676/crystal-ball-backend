import { createApp, type AppDeps } from '../../src/app';
import { type ApprovalRepository, FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import { queryInMemory } from '../../src/repositories/approvalQuery';
import type { Approval } from '../../src/schemas/approval.schema';
import { InMemoryConversationRepository } from '../../src/repositories/conversation.repository';
import { LlmService } from '../../src/services/ai/openai.service';
import { loadPolicyChunks } from '../../src/services/rag/policy.service';
import { FakeProvider, textScript, type FakeScript } from './fakes';

export const FRONTEND_URL = 'http://localhost:3000';
export const SESSION_ID = 'test-session-0001';

interface TestAppOptions {
  script?: FakeScript | ((req: Parameters<FakeProvider['createCompletion']>[0], i: number) => FakeScript);
  /** Pass `null` to simulate a missing OPENAI_API_KEY. */
  provider?: FakeProvider | null;
  timeoutMs?: number;
  rateLimits?: AppDeps['rateLimits'];
  /** Override the approval store (e.g. to simulate a status change between requests). */
  approvals?: AppDeps['approvals'];
}

/** In-memory approval repository whose records a test can change between requests. */
export function mutableApprovals(initial: Approval[]) {
  let records = initial.map((a) => ({ ...a }));
  const repo: ApprovalRepository = {
    source: 'fixture',
    list: async () => records.map((a) => ({ ...a })),
    query: async (q) => queryInMemory(records, q),
  };
  const setStatus = (id: string, status: Approval['status']) => {
    records = records.map((a) => (a.id === id ? { ...a, status } : a));
  };
  return { repo, setStatus };
}

/** Builds the real Express app wired to fakes: fixture data, in-memory history, fake GPT-4o. */
export function buildTestApp(options: TestAppOptions = {}) {
  const provider =
    options.provider === null ? null : (options.provider ?? new FakeProvider(options.script ?? textScript('Hello')));
  const conversations = new InMemoryConversationRepository();
  const approvals = options.approvals ?? new FixtureApprovalRepository();
  const llm = new LlmService(provider, {
    timeoutMs: options.timeoutMs ?? 200,
    idleTimeoutMs: options.timeoutMs ?? 200,
    maxStreamMs: 2_000,
  });

  const app = createApp({
    approvals,
    conversations,
    llm,
    policy: loadPolicyChunks(),
    frontendUrl: FRONTEND_URL,
    rateLimits: options.rateLimits ?? { ipPerMinute: 1_000, sessionPerMinute: 1_000 },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  return { app, provider, conversations, approvals, llm };
}
