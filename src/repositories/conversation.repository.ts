import { ConversationModel } from '../models/Conversation';

export type ConversationAction = 'chat' | 'help' | 'teach';

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/** Stored history is capped per (session, action) so documents and prompts stay small. */
export const MAX_STORED_MESSAGES = 20;
const MAX_IN_MEMORY_SESSIONS = 1_000;

export interface ConversationRepository {
  readonly source: 'mongodb' | 'memory';
  getRecentMessages(sessionId: string, action: ConversationAction, limit: number): Promise<StoredMessage[]>;
  appendMessages(sessionId: string, action: ConversationAction, messages: StoredMessage[]): Promise<void>;
}

export class InMemoryConversationRepository implements ConversationRepository {
  readonly source = 'memory' as const;
  private readonly store = new Map<string, StoredMessage[]>();

  async getRecentMessages(sessionId: string, action: ConversationAction, limit: number) {
    return (this.store.get(`${sessionId}:${action}`) ?? []).slice(-limit);
  }

  async appendMessages(sessionId: string, action: ConversationAction, messages: StoredMessage[]) {
    const key = `${sessionId}:${action}`;
    const next = [...(this.store.get(key) ?? []), ...messages].slice(-MAX_STORED_MESSAGES);
    this.store.delete(key); // re-insert so Map order tracks recency
    this.store.set(key, next);
    if (this.store.size > MAX_IN_MEMORY_SESSIONS) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }
}

export class MongoConversationRepository implements ConversationRepository {
  readonly source = 'mongodb' as const;

  async getRecentMessages(sessionId: string, action: ConversationAction, limit: number) {
    const doc = await ConversationModel.findOne(
      { sessionId, actionType: action },
      { messages: { $slice: -limit } },
    ).lean();
    return (doc?.messages ?? []).map((m) => ({
      role: m.role as StoredMessage['role'],
      content: m.content,
      timestamp: m.timestamp,
    }));
  }

  async appendMessages(sessionId: string, action: ConversationAction, messages: StoredMessage[]) {
    await ConversationModel.updateOne(
      { sessionId, actionType: action },
      { $push: { messages: { $each: messages, $slice: -MAX_STORED_MESSAGES } } },
      { upsert: true },
    );
  }
}
