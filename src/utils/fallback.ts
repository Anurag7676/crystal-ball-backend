/**
 * Deterministic, non-AI answers used when GPT-4o is unavailable, slow, or returns something
 * we can't trust. Each one is built only from known data so it can't be wrong in new ways.
 */

export function greetingFallback(pendingCount: number): string {
  if (pendingCount === 0) return 'Welcome back. You have no pending approvals.';
  return `Welcome back. You have ${pendingCount} pending approval${pendingCount === 1 ? '' : 's'}.`;
}
