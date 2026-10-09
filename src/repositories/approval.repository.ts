import fixture from '../data/approvals.json';
import { ApprovalModel } from '../models/Approval';
import {
  type Approval,
  ApprovalListSchema,
  type ApprovalPage,
  type ApprovalQuery,
} from '../schemas/approval.schema';
import { buildMongoFilter, pageWindow, queryInMemory, sortFacet } from './approvalQuery';

export interface ApprovalRepository {
  readonly source: 'mongodb' | 'fixture';
  /** Whole queue — used as AI context. */
  list(): Promise<Approval[]>;
  /** Filtered, paginated view — used by the approvals table. */
  query(query: ApprovalQuery): Promise<ApprovalPage>;
}

/** Canonical seed data; also the fallback when MongoDB is not configured or unreachable. */
export class FixtureApprovalRepository implements ApprovalRepository {
  readonly source = 'fixture' as const;
  private readonly approvals = ApprovalListSchema.parse(fixture);

  async list(): Promise<Approval[]> {
    return this.approvals.map((a) => ({ ...a }));
  }

  async query(query: ApprovalQuery): Promise<ApprovalPage> {
    return queryInMemory(this.approvals, query);
  }
}

const PROJECTION = { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 };

export class MongoApprovalRepository implements ApprovalRepository {
  readonly source = 'mongodb' as const;

  async list(): Promise<Approval[]> {
    const docs = await ApprovalModel.find({}, PROJECTION).sort({ id: 1 }).lean();
    // Validate on the way out so a hand-edited DB row can't break the UI or the prompts.
    return ApprovalListSchema.parse(docs);
  }

  async query(query: ApprovalQuery): Promise<ApprovalPage> {
    const filter = buildMongoFilter(query);
    const [total, pendingCount, facetResult] = await Promise.all([
      ApprovalModel.countDocuments(filter),
      ApprovalModel.countDocuments({ status: 'pending_review' }),
      ApprovalModel.aggregate<Record<'type' | 'submittedBy' | 'status', { _id: string; count: number }[]>>([
        {
          $facet: {
            type: [{ $group: { _id: '$type', count: { $sum: 1 } } }],
            submittedBy: [{ $group: { _id: '$submittedBy', count: { $sum: 1 } } }],
            status: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          },
        },
      ]),
    ]);

    const { page, pageCount, skip } = pageWindow(total, query.page, query.pageSize);
    const docs = await ApprovalModel.find(filter, PROJECTION).sort({ id: 1 }).skip(skip).limit(query.pageSize).lean();
    const facets = facetResult[0] ?? { type: [], submittedBy: [], status: [] };
    const toFacet = (rows: { _id: string; count: number }[]) =>
      sortFacet(rows.map((r) => ({ value: r._id, count: r.count })));

    return {
      approvals: ApprovalListSchema.parse(docs),
      total,
      page,
      pageSize: query.pageSize,
      pageCount,
      pendingCount,
      facets: { type: toFacet(facets.type), submittedBy: toFacet(facets.submittedBy), status: toFacet(facets.status) },
    };
  }
}

export const countPending = (approvals: Approval[]) =>
  approvals.filter((a) => a.status === 'pending_review').length;
