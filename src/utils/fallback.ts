import type { Summary } from '../schemas/ai.schema';
import type { Approval } from '../schemas/approval.schema';

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
