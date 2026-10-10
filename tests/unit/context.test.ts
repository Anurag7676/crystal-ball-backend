import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import type { Approval } from '../../src/schemas/approval.schema';
import { findReferencedApprovals, loadQueue } from '../../src/services/ai/context';
import { mutableApprovals } from '../helpers/testApp';

let all: Approval[];
beforeAll(async () => {
  all = await new FixtureApprovalRepository().list();
});

const ids = (items: Approval[]) => items.map((a) => a.id);

describe('findReferencedApprovals', () => {
  it.each([
    ['the full title', 'What should I check for Level 2 Drone Patrol Video Demo?', ['apr-002']],
    ['a short description', 'Who submitted the drone video?', ['apr-002']],
    ['an id', 'Is apr-004 ready?', ['apr-004']],
    ['two items', 'Compare the safety specs with the drone patrol video', ['apr-002', 'apr-003']],
  ])('finds items referenced by %s', (_label, text, expected) => {
    expect(ids(findReferencedApprovals([text], all))).toEqual(expected);
  });

  it.each(['How do I review videos?', 'What is the review workflow?', 'Who submitted it?', 'apr-999 status?'])(
    'finds nothing for "%s" (a single generic word or unknown id is not a reference)',
    (text) => {
      expect(findReferencedApprovals([text], all)).toEqual([]);
    },
  );
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
