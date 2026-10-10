import type { ApprovalRepository } from '../../repositories/approval.repository';
import type { Approval } from '../../schemas/approval.schema';
import { significantWords } from '../../utils/fallback';
import type { PolicyChunk } from '../rag/policy.service';
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

/** Folds simple plurals so "videos"/"video" and "checklists"/"checklist" compare equal. */
const singular = (word: string) => (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
const keyWords = (text: string) => new Set([...significantWords(text)].map(singular));

/**
 * Vocabulary the policy itself uses (safety, equipment, sensor, video, checklist, …). Title words
 * in this set describe a *kind* of content, so on their own they do not identify an item.
 */
export function policyVocabulary(policy: PolicyChunk[]): Set<string> {
  return keyWords(policy.map((c) => `${c.heading} ${c.text}`).join(' '));
}

/**
 * Approvals the texts clearly refer to: by id ("apr-003"), by exact (or quoted) title, or by an
 * unambiguous short name — at least two title words, one of which is specific to that item rather
 * than general policy vocabulary ("the drone video", "the safety specs"). "Safety equipment" shares
 * two title words with apr-003 but both are policy terms, so a general question stays general.
 */
export function findReferencedApprovals(
  texts: string[],
  approvals: Approval[],
  genericWords: Set<string> = new Set(),
): Approval[] {
  const joined = texts.join('\n');
  const ids = new Set(joined.toLowerCase().match(/\bapr-\d{3}\b/g) ?? []);
  const words = keyWords(joined);
  const normalisedText = ` ${normalise(joined)} `;

  return approvals.filter((a) => {
    if (ids.has(a.id)) return true;
    if (normalisedText.includes(` ${normalise(a.title)} `)) return true;
    const matched = [...keyWords(a.title)].filter((w) => words.has(w));
    return matched.length >= 2 && matched.some((w) => !genericWords.has(w));
  });
}

/** Words that point back at something already mentioned ("it", "this item", "that one"…). */
const BACK_REFERENCE = /\b(it|its|this|that|these|those|they|them|the item|the same)\b/i;

/**
 * Items the current message references; for an explicit follow-up ("who submitted it?", "how do I
 * review this item?") the item named in the operator's previous message. A new question without
 * a back-reference never inherits an earlier item.
 */
export function referencedInConversation(
  message: string,
  history: ChatMessage[],
  approvals: Approval[],
  genericWords: Set<string> = new Set(),
): Approval[] {
  const direct = findReferencedApprovals([message], approvals, genericWords);
  if (direct.length || !BACK_REFERENCE.test(message)) return direct;
  const previous = [...history].reverse().find((m) => m.role === 'user');
  return previous ? findReferencedApprovals([previous.content], approvals, genericWords) : [];
}
