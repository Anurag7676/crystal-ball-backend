import { buildMongoFilter, queryInMemory } from '../../src/repositories/approvalQuery';
import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import { type Approval, type ApprovalQuery, ApprovalQuerySchema } from '../../src/schemas/approval.schema';

let all: Approval[];
beforeAll(async () => {
  all = await new FixtureApprovalRepository().list();
});

const q = (raw: Record<string, unknown> = {}): ApprovalQuery => ApprovalQuerySchema.parse(raw);
const ids = (res: { approvals: Approval[] }) => res.approvals.map((a) => a.id);

describe('ApprovalQuerySchema', () => {
  it('applies defaults', () => {
    expect(q()).toEqual({ page: 1, pageSize: 10 });
  });

  it('accepts comma-separated and repeated list params', () => {
    expect(q({ type: 'pdf,folder' }).type).toEqual(['pdf', 'folder']);
    expect(q({ type: ['pdf', 'video'] }).type).toEqual(['pdf', 'video']);
    expect(q({ submittedBy: 'Sam HelpAdmin' }).submittedBy).toEqual(['Sam HelpAdmin']);
  });

  it('treats empty values as absent', () => {
    expect(q({ q: '  ', type: '' })).toEqual({ page: 1, pageSize: 10 });
  });

  it.each([
    ['an unknown type', { type: 'doc' }],
    ['a page size above the max', { pageSize: '500' }],
    ['page 0', { page: '0' }],
    ['a non-numeric page', { page: 'two' }],
    ['an over-long search', { q: 'x'.repeat(101) }],
    ['unknown params', { sort: 'title' }],
  ])('rejects %s', (_label, raw) => {
    expect(ApprovalQuerySchema.safeParse(raw).success).toBe(false);
  });
});

describe('queryInMemory', () => {
  it('returns the first page with totals, facets and the global pending count', () => {
    const res = queryInMemory(all, q());

    expect(ids(res)).toEqual(['apr-001', 'apr-002', 'apr-003', 'apr-004']);
    expect(res).toMatchObject({ total: 4, page: 1, pageSize: 10, pageCount: 1, pendingCount: 4 });
    expect(res.facets.type).toEqual([
      { value: 'folder', count: 1 },
      { value: 'image', count: 1 },
      { value: 'pdf', count: 1 },
      { value: 'video', count: 1 },
    ]);
    expect(res.facets.submittedBy).toEqual([
      { value: 'Alex HelpAdmin', count: 1 },
      { value: 'Elena HelpAdmin', count: 1 },
      { value: 'Sam HelpAdmin', count: 2 },
    ]);
    expect(res.facets.status).toEqual([{ value: 'pending_review', count: 4 }]);
  });

  it('searches title, submitter and type case-insensitively', () => {
    expect(ids(queryInMemory(all, q({ q: 'CAMERA' })))).toEqual(['apr-004']);
    expect(ids(queryInMemory(all, q({ q: 'elena' })))).toEqual(['apr-004']);
    expect(ids(queryInMemory(all, q({ q: 'pdf' })))).toEqual(['apr-003']);
  });

  it('ORs values within a filter and ANDs across filters', () => {
    expect(ids(queryInMemory(all, q({ type: 'pdf,folder' })))).toEqual(['apr-001', 'apr-003']);
    expect(ids(queryInMemory(all, q({ type: 'pdf,folder,video', submittedBy: 'Sam HelpAdmin' })))).toEqual([
      'apr-001',
      'apr-003',
    ]);
  });

  it('keeps facets and pendingCount independent of the active filters', () => {
    const res = queryInMemory(all, q({ type: 'pdf' }));
    expect(res.total).toBe(1);
    expect(res.pendingCount).toBe(4);
    expect(res.facets.type).toHaveLength(4);
  });

  it('paginates and clamps an out-of-range page to the last page', () => {
    expect(ids(queryInMemory(all, q({ pageSize: '3', page: '2' })))).toEqual(['apr-004']);

    const clamped = queryInMemory(all, q({ pageSize: '3', page: '9' }));
    expect(clamped).toMatchObject({ page: 2, pageCount: 2, total: 4 });
    expect(ids(clamped)).toEqual(['apr-004']);
  });

  it('returns an empty first page when nothing matches', () => {
    expect(queryInMemory(all, q({ q: 'cafeteria' }))).toMatchObject({ approvals: [], total: 0, page: 1, pageCount: 1 });
  });
});

describe('buildMongoFilter', () => {
  it('is empty when there are no filters', () => {
    expect(buildMongoFilter(q())).toEqual({});
  });

  it('maps list filters to $in and search to escaped, case-insensitive regexes', () => {
    const filter = buildMongoFilter(q({ type: 'pdf,video', submittedBy: 'Sam HelpAdmin', q: 'a.b*(c' }));

    expect(filter.type).toEqual({ $in: ['pdf', 'video'] });
    expect(filter.submittedBy).toEqual({ $in: ['Sam HelpAdmin'] });
    const regex = (filter.$or as { title: RegExp }[])[0]!.title;
    expect(regex.source).toBe('a\\.b\\*\\(c');
    expect(regex.flags).toBe('i');
    expect(regex.test('xA.B*(Cx')).toBe(true);
    expect(regex.test('axbbc')).toBe(false);
  });
});
