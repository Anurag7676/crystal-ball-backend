import mongoose from 'mongoose';
import {
  type ApprovalRepository,
  FixtureApprovalRepository,
  MongoApprovalRepository,
} from '../repositories/approval.repository';
import {
  type ConversationRepository,
  InMemoryConversationRepository,
  MongoConversationRepository,
} from '../repositories/conversation.repository';
import type { Logger } from '../utils/logger';

export interface DataLayer {
  approvals: ApprovalRepository;
  conversations: ConversationRepository;
}

interface InitOptions {
  mongoUri: string | undefined;
  logger: Logger;
  connect?: (uri: string) => Promise<unknown>;
}

const defaultConnect = (uri: string) => mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });

const fallbackLayer = (): DataLayer => ({
  approvals: new FixtureApprovalRepository(),
  conversations: new InMemoryConversationRepository(),
});

/**
 * MongoDB is an optional enhancement. Without it (or if it is unreachable) the API serves the
 * JSON fixture and keeps conversation history in memory, so every AI feature still works.
 */
export async function initDataLayer({ mongoUri, logger, connect = defaultConnect }: InitOptions): Promise<DataLayer> {
  if (!mongoUri) {
    logger.warn('MONGODB_URI not set — using JSON fixture and in-memory conversation storage');
    return fallbackLayer();
  }

  try {
    await connect(mongoUri);
    logger.info('Connected to MongoDB');
    return { approvals: new MongoApprovalRepository(), conversations: new MongoConversationRepository() };
  } catch (err) {
    // Log only the error name/code — the URI can contain credentials.
    const reason = err instanceof Error ? err.name : 'UnknownError';
    logger.warn('MongoDB connection failed — falling back to JSON fixture and in-memory storage', { reason });
    return fallbackLayer();
  }
}
