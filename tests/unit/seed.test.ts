import { buildSeedOperations } from '../../scripts/seed';
import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';

describe('seed script', () => {
  it('upserts each fixture record by its stable id, so re-running never duplicates', async () => {
    const approvals = await new FixtureApprovalRepository().list();

    const ops = buildSeedOperations(approvals);

    expect(ops).toHaveLength(4);
    for (const [i, op] of ops.entries()) {
      expect(op.updateOne.filter).toEqual({ id: approvals[i]!.id });
      expect(op.updateOne.upsert).toBe(true);
      expect(op.updateOne.update.$set).toEqual(approvals[i]);
    }
  });
});
