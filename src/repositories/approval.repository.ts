import fixture from '../data/approvals.json';
import { ApprovalModel } from '../models/Approval';
import { type Approval, ApprovalListSchema } from '../schemas/approval.schema';

export interface ApprovalRepository {
  readonly source: 'mongodb' | 'fixture';
  list(): Promise<Approval[]>;
}

/** Canonical seed data; also the fallback when MongoDB is not configured or unreachable. */
export class FixtureApprovalRepository implements ApprovalRepository {
  readonly source = 'fixture' as const;
  private readonly approvals = ApprovalListSchema.parse(fixture);

  async list(): Promise<Approval[]> {
    return this.approvals.map((a) => ({ ...a }));
  }
}

export class MongoApprovalRepository implements ApprovalRepository {
  readonly source = 'mongodb' as const;

  async list(): Promise<Approval[]> {
    const docs = await ApprovalModel.find({}, { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 })
      .sort({ id: 1 })
      .lean();
    // Validate on the way out so a hand-edited DB row can't break the UI or the prompts.
    return ApprovalListSchema.parse(docs);
  }
}

export const countPending = (approvals: Approval[]) =>
  approvals.filter((a) => a.status === 'pending_review').length;
