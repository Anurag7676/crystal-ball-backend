import type { PolicyChunk } from './policy.service';

/**
 * Lightweight in-memory retrieval: keyword overlap weighted by inverse document frequency.
 * With 4 short chunks this is transparent, deterministic and testable — embeddings or a vector
 * DB would add cost and opacity without improving results at this size.
 */

const STOP_WORDS = new Set(
  (
    'a an the and or but if then else of to in on at by for with from as is are was were be been being do does did ' +
    'can could should would will shall may might must i me my myself we our you your it its this that these those ' +
    'there here what which who whom whose when where why how am about into over under again once all any both each ' +
    'few more most other some such no nor not only own same so than too very just also after before up down out ' +
    'off get got have has had please tell explain'
  ).split(' '),
);

function stem(word: string): string {
  let w = word;
  let strippedSuffix = false;
  if (w.length > 7 && w.endsWith('ission')) {
    // "resubmission" → "resubmit", so it matches "resubmit" / "resubmitted"
    w = `${w.slice(0, -6)}it`;
  } else if (w.length > 5 && w.endsWith('ing')) {
    w = w.slice(0, -3);
    strippedSuffix = true;
  } else if (w.length > 4 && w.endsWith('ed')) {
    w = w.slice(0, -2);
    strippedSuffix = true;
  } else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) {
    w = w.slice(0, -1);
  }
  // "submitted" → "submitt" → "submit"
  if (strippedSuffix && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map(stem);
}

export interface RetrievedChunk extends PolicyChunk {
  score: number;
}

export const DEFAULT_TOP_K = 2;

/**
 * Questions about whether the policy contains a kind of rule anywhere (deadlines, time limits,
 * requirements, mandatory approvals, exceptions) can only be answered truthfully from the whole
 * policy — top-k retrieval would let the model claim "no such rule" from partial context. The
 * policy is ~320 words, so sending all of it for these questions is cheap.
 */
const WHOLE_POLICY_QUESTION =
  /\b(deadlines?|time[- ]limits?|time[- ]related|timeframes?|turnaround|how long|within|hours?|days?|overdue|requires?|required|requirements?|mandatory|must|obligat\w*|exceptions?|any rules?|all (?:the )?rules)\b/i;

export const asksAboutWholePolicy = (question: string) => WHOLE_POLICY_QUESTION.test(question);

export function retrieve(query: string, chunks: PolicyChunk[], k = DEFAULT_TOP_K): RetrievedChunk[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  // Headings are counted twice: they summarise what the chunk is about.
  const docs = chunks.map((c) => tokenize(`${c.heading} ${c.heading} ${c.text}`));
  const docFreq = (term: string) => docs.filter((d) => d.includes(term)).length;

  return chunks
    .map((chunk, i) => {
      const doc = docs[i]!;
      const score = queryTerms.reduce((sum, term) => {
        const tf = doc.filter((t) => t === term).length;
        if (tf === 0) return sum;
        const idf = Math.log(1 + chunks.length / docFreq(term));
        return sum + idf * (1 + Math.log(tf));
      }, 0);
      return { ...chunk, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
