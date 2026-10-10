import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import type { Approval } from '../../src/schemas/approval.schema';
import {
  findReferencedApprovals,
  loadQueue,
  policyVocabulary,
  referencedInConversation,
} from '../../src/services/ai/context';
import { loadPolicyChunks } from '../../src/services/rag/policy.service';
import { mutableApprovals } from '../helpers/testApp';

let all: Approval[];
beforeAll(async () => {
  all = await new FixtureApprovalRepository().list();
});

const ids = (items: Approval[]) => items.map((a) => a.id);
const generic = () => policyVocabulary(loadPolicyChunks());

describe('findReferencedApprovals', () => {
  it.each([
    ['the full title', 'What should I check for Level 2 Drone Patrol Video Demo?', ['apr-002']],
    ['the quoted title sent by the detail panel', 'How do I review "Safety Equipment & Sensor Specs"?', ['apr-003']],
    ['an unambiguous short name', 'Who submitted the drone video?', ['apr-002']],
    ['another short name', 'Are the safety specs complete?', ['apr-003']],
    ['an id', 'What should I check for apr-003?', ['apr-003']],
    ['two items', 'Compare the safety specs with the drone patrol video', ['apr-002', 'apr-003']],
  ])('finds items referenced by %s', (_label, text, expected) => {
    expect(ids(findReferencedApprovals([text], all, generic()))).toEqual(expected);
  });

  it.each([
    'What is the procedure for reviewing safety equipment?', // regression: matched apr-003 on generic policy words
    'How should I handle safety equipment and sensor documents?',
    'How do I review videos?',
    'What is the review workflow?',
    'Who submitted it?',
    'apr-999 status?',
  ])('keeps general questions general: "%s"', (text) => {
    expect(findReferencedApprovals([text], all, generic())).toEqual([]);
  });
});

describe('referencedInConversation (follow-ups)', () => {
  const after = (previous: string) => [
    { role: 'user' as const, content: previous },
    { role: 'assistant' as const, content: 'answer' },
  ];

  it('carries the previous item into an explicit follow-up ("this item", "it")', () => {
    const history = after('How do I review "Safety Equipment & Sensor Specs"?');
    expect(ids(referencedInConversation('How do I review this item?', history, all, generic()))).toEqual(['apr-003']);
    expect(ids(referencedInConversation('Who submitted it?', history, all, generic()))).toEqual(['apr-003']);
  });

  it('does not carry an item into a new general question', () => {
    const history = after('How do I review "Safety Equipment & Sensor Specs"?');
    expect(referencedInConversation('What is the procedure for reviewing safety equipment?', history, all, generic())).toEqual([]);
  });
});

describe('loadQueue', () => {
  it('reads current data on every call, so a status change is visible to the next request', async () => {
    const { repo, setStatus } = mutableApprovals(all);

    expect((await loadQueue(repo)).pending).toHaveLength(4);
    setStatus('apr-002', 'approved');
    const next = await loadQueue(repo);

    expect(next.pending.map((a) => a.id)).toEqual(['apr-001', 'apr-003', 'apr-004']);
    expect(next.all.find((a) => a.id === 'apr-002')!.status).toBe('approved');
  });
});
