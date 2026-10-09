import type { ConversationAction, ConversationRepository } from '../../repositories/conversation.repository';
import type { Logger } from '../../utils/logger';
import type { ChatMessage } from './openai.service';

/** How many prior messages (user + assistant) are sent back to the model on each turn. */
export const HISTORY_TURNS_IN_PROMPT = 10;

interface Ctx {
  conversations: ConversationRepository;
  logger: Logger;
  sessionId: string;
  action: ConversationAction;
}

/** Loads recent history; if storage is down the conversation continues without it. */
export async function loadHistory({ conversations, logger, sessionId, action }: Ctx): Promise<ChatMessage[]> {
  try {
    const stored = await conversations.getRecentMessages(sessionId, action, HISTORY_TURNS_IN_PROMPT);
    return stored.map(({ role, content }) => ({ role, content }));
  } catch (err) {
    logger.warn('Could not load conversation history', { action, error: err instanceof Error ? err.name : 'UnknownError' });
    return [];
  }
}

/** Returns an onComplete hook that stores the user question and the final reply. Never throws. */
export const persistTurn =
  ({ conversations, logger, sessionId, action }: Ctx, userMessage: string) =>
  async (reply: string) => {
    const now = new Date();
    try {
      await conversations.appendMessages(sessionId, action, [
        { role: 'user', content: userMessage, timestamp: now },
        { role: 'assistant', content: reply, timestamp: now },
      ]);
    } catch (err) {
      logger.warn('Could not save conversation turn', { action, error: err instanceof Error ? err.name : 'UnknownError' });
    }
  };
