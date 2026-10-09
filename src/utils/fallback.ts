import type { Summary } from '../schemas/ai.schema';
import type { Approval } from '../schemas/approval.schema';
import type { PolicyChunk } from '../services/rag/policy.service';

/**
 * Deterministic, non-AI answers used when GPT-4o is unavailable, slow, or returns something
 * we can't trust. Each one is built only from known data so it can't be wrong in new ways.
 */

export function greetingFallback(pendingCount: number): string {
  if (pendingCount === 0) return 'Welcome back. You have no pending approvals.';
  return `Welcome back. You have ${pendingCount} pending approval${pendingCount === 1 ? '' : 's'}.`;
}

/** Attached by the server to every summary (AI or fallback) — the model never decides this text. */
export const ORDERING_NOTE =
  'This is a suggested review order based on what each item contains (safety-related content first), ' +
  'not an official urgency classification. The queue has no deadlines or severity levels.';

const SAFETY_PATTERN = /\b(safety|sensor|emergency|restricted)\b/i;
export const isSafetyRelated = (approval: Approval) => SAFETY_PATTERN.test(approval.title);

const TYPE_NAMES: Record<Approval['type'], string> = { folder: 'folder', video: 'video', pdf: 'PDF', image: 'image' };

const TYPE_LABELS: Record<Approval['type'], string> = { folder: 'Folder', video: 'Video', pdf: 'PDF', image: 'Image' };
const IGNORED_WORDS = new Set(['submitted', 'submit', 'uploaded', 'approval', 'approvals', 'which', 'what', 'item', 'items']);

const significantWords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9°]+/)
      .filter((w) => w.length >= 4 && !IGNORED_WORDS.has(w)),
  );

/**
 * Chat fallback: answers only questions the dataset answers exactly. Returns null otherwise so
 * the client shows a retryable error instead of a guessed answer.
 */
export function chatFallback(message: string, approvals: Approval[]): string | null {
  const pending = approvals.filter((a) => a.status === 'pending_review');
  const text = message.toLowerCase();

  if (/\b(how many|count|number of)\b/.test(text)) {
    const n = pending.length;
    return `There ${n === 1 ? 'is' : 'are'} ${n} approval${n === 1 ? '' : 's'} pending review.`;
  }

  if (/\bwho\b/.test(text) && /\b(submit|submitted|sent|upload|uploaded|created)\b/.test(text)) {
    const words = significantWords(text);
    const matches = pending.filter((a) => [...significantWords(a.title)].some((w) => words.has(w)));
    if (matches.length !== 1) return null;
    const [item] = matches as [Approval];
    return `"${item.title}" was submitted by ${item.submittedBy} on ${item.submittedDateLabel}.`;
  }

  if (/\b(list|show)\b/.test(text)) {
    if (pending.length === 0) return 'There are no approvals pending review.';
    return [
      'The pending approvals are:',
      ...pending.map(
        (a, i) => `${i + 1}. ${a.title} (${TYPE_LABELS[a.type]}, submitted by ${a.submittedBy} on ${a.submittedDateLabel})`,
      ),
    ].join('\n');
  }

  return null;
}

/** Help fallback: quote the best retrieved policy section verbatim, or say we have nothing. */
export function helpFallback(chunks: PolicyChunk[]): string {
  const [best] = chunks;
  if (!best) {
    return "The AI assistant is unavailable, and I couldn't find a section of the approval policy that answers this question.";
  }
  return (
    'The AI assistant is unavailable, so here is the most relevant section of the approval policy:\n\n' +
    `[${best.id}] ${best.heading}: ${best.text}`
  );
}

export function summaryFallback(approvals: Approval[]): Summary {
  const pending = approvals.filter((a) => a.status === 'pending_review');
  const ordered = [...pending.filter(isSafetyRelated), ...pending.filter((a) => !isSafetyRelated(a))];
  const dates = [...new Set(pending.map((a) => a.submittedDateLabel))];
  const types = pending.map((a) => TYPE_NAMES[a.type]);

  return {
    pendingCount: pending.length,
    overview:
      pending.length === 0
        ? 'There are no approvals waiting for review.'
        : `${pending.length} item${pending.length === 1 ? ' is' : 's are'} pending review (${types.join(', ')}), ` +
          `submitted ${dates.length === 1 ? `on ${dates[0]}` : `between ${dates.join(' and ')}`}.`,
    priorityItems: ordered.map((a) => ({
      approvalId: a.id,
      title: a.title,
      reason: isSafetyRelated(a)
        ? 'Safety-related content — the approval policy (policy-3) asks reviewers to check these before other items.'
        : 'No formal priority is recorded for this item; listed in queue order.',
    })),
    recommendations: [
      'Confirm the title, type and submitter of each item before opening it (policy-2, step 1).',
      'For safety-related items, check equipment specifications against the models deployed on site (policy-3).',
    ],
    orderingNote: ORDERING_NOTE,
  };
}
