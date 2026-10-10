import {
  type ConversationAction,
  type ConversationRepository,
  MAX_STORED_MESSAGES,
} from '../../repositories/conversation.repository';
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

export interface HistoryWindow {
  /** Chronological user/assistant messages, always starting with a user turn. */
  messages: ChatMessage[];
  /** True when older messages exist (or were dropped from storage) but are not included. */
  truncated: boolean;
}

/**
 * Loads up to `maxMessages` recent messages, then drops the oldest whole messages until the
 * total fits `maxChars` (a cheap token budget). The window never starts with an assistant turn,
 * and `truncated` tells the prompt that earlier context exists but is not shown.
 */
export async function loadHistoryWindow(
  { conversations, logger, sessionId, action }: Ctx,
  { maxMessages, maxChars }: { maxMessages: number; maxChars: number },
): Promise<HistoryWindow> {
  let stored: ChatMessage[];
  try {
    stored = (await conversations.getRecentMessages(sessionId, action, maxMessages)).map(({ role, content }) => ({
      role,
      content,
    }));
  } catch (err) {
    logger.warn('Could not load conversation history', { action, error: err instanceof Error ? err.name : 'UnknownError' });
    return { messages: [], truncated: false };
  }

  let start = stored.length;
  let chars = 0;
  while (start > 0 && chars + stored[start - 1]!.content.length <= maxChars) {
    start -= 1;
    chars += stored[start]!.content.length;
  }
  while (start < stored.length && stored[start]!.role !== 'user') start += 1;

  // Storage keeps at most MAX_STORED_MESSAGES, so a full store means older turns were dropped.
  const truncated = start > 0 || stored.length >= MAX_STORED_MESSAGES;
  return { messages: stored.slice(start), truncated };
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
