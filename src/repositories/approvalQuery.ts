import type { Approval, ApprovalFacets, ApprovalPage, ApprovalQuery } from '../schemas/approval.schema';

type Facet = ApprovalFacets['type'];

/** Shared paging math so the fixture and MongoDB paths behave identically. */
export function pageWindow(total: number, page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  return { page: current, pageCount, skip: (current - 1) * pageSize };
}

export const sortFacet = (facet: Facet): Facet => [...facet].sort((a, b) => a.value.localeCompare(b.value));

function countBy(approvals: Approval[], key: 'type' | 'submittedBy' | 'status'): Facet {
  const counts = new Map<string, number>();
  for (const a of approvals) counts.set(a[key], (counts.get(a[key]) ?? 0) + 1);
  return sortFacet([...counts].map(([value, count]) => ({ value, count })));
}

function matches(a: Approval, { q, type, submittedBy, status }: ApprovalQuery): boolean {
  if (type && !type.includes(a.type)) return false;
  if (submittedBy && !submittedBy.includes(a.submittedBy)) return false;
  if (status && !status.includes(a.status)) return false;
  if (q) {
    const needle = q.toLowerCase();
    return [a.title, a.submittedBy, a.type].some((field) => field.toLowerCase().includes(needle));
  }
  return true;
}

/**
 * Fixture-backed query: filters within a facet are OR'd, across facets AND'd.
 * Facets and pendingCount describe the whole queue so filter menus stay stable.
 */
export function queryInMemory(all: Approval[], query: ApprovalQuery): ApprovalPage {
  const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
  const filtered = sorted.filter((a) => matches(a, query));
  const { page, pageCount, skip } = pageWindow(filtered.length, query.page, query.pageSize);

  return {
    approvals: filtered.slice(skip, skip + query.pageSize).map((a) => ({ ...a })),
    total: filtered.length,
    page,
    pageSize: query.pageSize,
    pageCount,
    pendingCount: all.filter((a) => a.status === 'pending_review').length,
    facets: {
      type: countBy(all, 'type'),
      submittedBy: countBy(all, 'submittedBy'),
      status: countBy(all, 'status'),
    },
  };
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** MongoDB filter equivalent of `matches`. User text is regex-escaped, never interpreted. */
export function buildMongoFilter({ q, type, submittedBy, status }: ApprovalQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (type) filter.type = { $in: type };
  if (submittedBy) filter.submittedBy = { $in: submittedBy };
  if (status) filter.status = { $in: status };
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: pattern }, { submittedBy: pattern }, { type: pattern }];
  }
  return filter;
}
