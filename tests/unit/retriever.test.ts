import { asksAboutWholePolicy, retrieve, tokenize } from '../../src/services/rag/retriever';
import { loadPolicyChunks, parsePolicyChunks } from '../../src/services/rag/policy.service';

const chunks = loadPolicyChunks();
const ids = (question: string) => retrieve(question, chunks).map((c) => c.id);

describe('policy document', () => {
  it('is split into 4 chunks with stable citation ids', () => {
    expect(chunks.map((c) => c.id)).toEqual(['policy-1', 'policy-2', 'policy-3', 'policy-4']);
    expect(chunks.every((c) => c.heading && c.text.length > 50)).toBe(true);
  });

  it('stays within the assignment’s 200–400 word budget', () => {
    const words = chunks.flatMap((c) => `${c.heading} ${c.text}`.split(/\s+/)).length;
    expect(words).toBeGreaterThanOrEqual(200);
    expect(words).toBeLessThanOrEqual(400);
  });

  it('parses chunk headings and ignores the leading disclaimer comment', () => {
    const parsed = parsePolicyChunks('<!-- mock -->\n\n## [policy-1] Title\n\nLine one.\nLine two.\n');
    expect(parsed).toEqual([{ id: 'policy-1', heading: 'Title', text: 'Line one. Line two.' }]);
  });
});

describe('tokenize', () => {
  it('lower-cases, drops stop words and normalises simple inflections', () => {
    expect(tokenize('Approving the Videos that were submitted')).toEqual(['approv', 'video', 'submit']);
    expect(tokenize('approve approved approval')).toEqual(['approv', 'approv', 'approval']);
  });
});

describe('retrieve (keyword + IDF scoring)', () => {
  it.each([
    ['Can I review an item I submitted myself?', 'policy-1'],
    ['What are the steps to review an approval?', 'policy-2'],
    ['How should I handle safety equipment and sensor documents?', 'policy-3'],
    ['What video resolution is required?', 'policy-4'],
    ['What happens after I reject something and it is resubmitted?', 'policy-4'],
  ])('ranks the right chunk first for "%s"', (question, expected) => {
    expect(ids(question)[0]).toBe(expected);
  });

  it('returns at most k chunks', () => {
    expect(retrieve('review approval video safety image policy', chunks, 2)).toHaveLength(2);
  });

  it('returns nothing when the policy does not cover the question', () => {
    expect(ids('What is on the cafeteria menu today?')).toEqual([]);
    expect(ids('what is the')).toEqual([]);
  });
});

describe('asksAboutWholePolicy', () => {
  it.each([
    'Does the policy require safety lead approval within 24 hours?',
    'Are there any time-related rules in the policy?',
    'What happens after 5 working days?',
    'Is there a deadline for reviewing videos?',
    'Are there any exceptions to the review steps?',
    'Is safety lead sign-off mandatory?',
  ])('treats "%s" as a whole-policy question', (question) => {
    expect(asksAboutWholePolicy(question)).toBe(true);
  });

  it.each([
    'What is the procedure for reviewing safety equipment?',
    'What video resolution is needed?',
    'Can I review an item I submitted myself?',
    'What is on the cafeteria menu today?',
  ])('keeps normal retrieval for "%s"', (question) => {
    expect(asksAboutWholePolicy(question)).toBe(false);
  });
});
