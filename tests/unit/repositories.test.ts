import { initDataLayer } from '../../src/config/database';
import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import {
  InMemoryConversationRepository,
  MAX_STORED_MESSAGES,
} from '../../src/repositories/conversation.repository';

const silentLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('FixtureApprovalRepository', () => {
  it('returns the four fixture approvals as defensive copies', async () => {
    const repo = new FixtureApprovalRepository();

    const first = await repo.list();
    first[0]!.title = 'mutated';
    const second = await repo.list();

    expect(second).toHaveLength(4);
    expect(second[0]!.title).toBe('Site Patrol Onboarding & Checklists');
  });
});

describe('InMemoryConversationRepository', () => {
  const msg = (content: string) => ({ role: 'user' as const, content, timestamp: new Date() });

  it('keeps history separate per session and per action', async () => {
    const repo = new InMemoryConversationRepository();
    await repo.appendMessages('session-a', 'chat', [msg('chat a')]);
    await repo.appendMessages('session-a', 'help', [msg('help a')]);
    await repo.appendMessages('session-b', 'chat', [msg('chat b')]);

    expect((await repo.getRecentMessages('session-a', 'chat', 10)).map((m) => m.content)).toEqual(['chat a']);
    expect((await repo.getRecentMessages('session-a', 'help', 10)).map((m) => m.content)).toEqual(['help a']);
  });

  it('bounds stored history and returns only the most recent messages', async () => {
    const repo = new InMemoryConversationRepository();
    for (let i = 0; i < MAX_STORED_MESSAGES + 5; i++) {
      await repo.appendMessages('session-a', 'chat', [msg(`m${i}`)]);
    }

    const all = await repo.getRecentMessages('session-a', 'chat', 1_000);
    expect(all).toHaveLength(MAX_STORED_MESSAGES);
    expect(all.at(-1)?.content).toBe(`m${MAX_STORED_MESSAGES + 4}`);

    const lastTwo = await repo.getRecentMessages('session-a', 'chat', 2);
    expect(lastTwo.map((m) => m.content)).toEqual([`m${MAX_STORED_MESSAGES + 3}`, `m${MAX_STORED_MESSAGES + 4}`]);
  });
});

describe('initDataLayer (MongoDB is optional)', () => {
  it('falls back to the JSON fixture and in-memory history when MONGODB_URI is missing', async () => {
    const logger = silentLogger();
    const connect = jest.fn();

    const data = await initDataLayer({ mongoUri: undefined, logger, connect });

    expect(connect).not.toHaveBeenCalled();
    expect(data.approvals.source).toBe('fixture');
    expect(data.conversations.source).toBe('memory');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/MONGODB_URI/));
  });

  it('falls back without crashing when the MongoDB connection fails', async () => {
    const logger = silentLogger();
    const connect = jest.fn().mockRejectedValue(new Error('querySrv ENOTFOUND'));

    const data = await initDataLayer({ mongoUri: 'mongodb+srv://user:secret@cluster.example/db', logger, connect });

    expect(data.approvals.source).toBe('fixture');
    expect(data.conversations.source).toBe('memory');
    // The connection string (with credentials) must never be logged.
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });

  it('uses MongoDB-backed repositories when the connection succeeds', async () => {
    const data = await initDataLayer({
      mongoUri: 'mongodb://localhost/test',
      logger: silentLogger(),
      connect: jest.fn().mockResolvedValue(undefined),
    });

    expect(data.approvals.source).toBe('mongodb');
    expect(data.conversations.source).toBe('mongodb');
  });
});
