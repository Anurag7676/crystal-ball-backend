import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PolicyChunk {
  /** Stable id used for citations, e.g. "policy-2". */
  id: string;
  heading: string;
  text: string;
}

const POLICY_PATH = join(__dirname, '..', '..', 'data', 'approval-policy.md');
const CHUNK_HEADING = /^## \[(policy-\d+)\]\s+(.+)$/;

/** Splits the mock policy markdown into chunks on its "## [policy-N] Heading" lines. */
export function parsePolicyChunks(markdown: string): PolicyChunk[] {
  const chunks: PolicyChunk[] = [];
  let current: PolicyChunk | undefined;

  for (const line of markdown.split('\n')) {
    const heading = CHUNK_HEADING.exec(line.trim());
    if (heading) {
      current = { id: heading[1]!, heading: heading[2]!, text: '' };
      chunks.push(current);
    } else if (current && line.trim()) {
      current.text = current.text ? `${current.text} ${line.trim()}` : line.trim();
    }
  }
  return chunks;
}

const CITATION = /\[(policy-\d+)\]/g;

/**
 * Lightweight post-check on free text: which cited ids were really provided to the model.
 * It can't prove an answer is correct — only that its citations point at real, retrieved chunks.
 */
export function verifyCitations(text: string, retrievedIds: string[]): { valid: string[]; invalid: string[] } {
  const cited = [...new Set([...text.matchAll(CITATION)].map((m) => m[1]!))];
  return {
    valid: cited.filter((id) => retrievedIds.includes(id)),
    invalid: cited.filter((id) => !retrievedIds.includes(id)),
  };
}

let cached: PolicyChunk[] | undefined;

export function loadPolicyChunks(): PolicyChunk[] {
  cached ??= parsePolicyChunks(readFileSync(POLICY_PATH, 'utf8'));
  return cached;
}
