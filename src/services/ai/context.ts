import type { ApprovalRepository } from '../../repositories/approval.repository';
import type { Approval } from '../../schemas/approval.schema';
import { significantWords } from '../../utils/fallback';
import type { ChatMessage } from './openai.service';

/**
 * Shared context assembly for the AI actions. Every request reads the queue fresh through the
 * repository (MongoDB or fixture), so prompts never use a stale snapshot.
 */

export interface QueueSnapshot {
  all: Approval[];
  pending: Approval[];
}

export async function loadQueue(approvals: ApprovalRepository): Promise<QueueSnapshot> {
  const all = await approvals.list();
  return { all, pending: all.filter((a) => a.status === 'pending_review') };
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9°]+/g, ' ').trim();

/**
 * Approvals the texts explicitly refer to: by id ("apr-002"), by full title, or by at least two
 * distinctive title words ("the drone video"). A single generic word ("videos") is not enough.
 * Deterministic, so the model is never left to guess which record an operator meant.
 */
export function findReferencedApprovals(texts: string[], approvals: Approval[]): Approval[] {
  const joined = texts.join('\n');
  const ids = new Set(joined.toLowerCase().match(/\bapr-\d{3}\b/g) ?? []);
  const words = significantWords(joined);
  const normalisedText = ` ${normalise(joined)} `;

  return approvals.filter((a) => {
    if (ids.has(a.id)) return true;
    if (normalisedText.includes(` ${normalise(a.title)} `)) return true;
    const titleWords = [...significantWords(a.title)];
    return titleWords.filter((w) => words.has(w)).length >= 2;
  });
}

/**
 * Items referenced by the current message, or — for follow-ups like "who submitted it?" — by the
 * operator's previous message in the same conversation.
 */
export function referencedInConversation(message: string, history: ChatMessage[], approvals: Approval[]): Approval[] {
  const direct = findReferencedApprovals([message], approvals);
  if (direct.length) return direct;
  const previous = [...history].reverse().find((m) => m.role === 'user');
  return previous ? findReferencedApprovals([previous.content], approvals) : [];
}
