import mongoose from 'mongoose';
import { loadEnvironment } from '../src/config/environment';
import fixture from '../src/data/approvals.json';
import { ApprovalModel } from '../src/models/Approval';
import { type Approval, ApprovalListSchema } from '../src/schemas/approval.schema';

/**
 * Idempotent: each record is upserted by its stable `id`, so running the seed repeatedly
 * updates the four records in place and never creates duplicates.
 */
export function buildSeedOperations(approvals: Approval[]) {
  return approvals.map((approval) => ({
    updateOne: {
      filter: { id: approval.id },
      update: { $set: approval },
      upsert: true,
    },
  }));
}

async function main() {
  const { MONGODB_URI } = loadEnvironment();
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Add it to .env to seed MongoDB (the API works without it).');
    process.exit(1);
  }
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await ApprovalModel.syncIndexes();
  const result = await ApprovalModel.bulkWrite(buildSeedOperations(ApprovalListSchema.parse(fixture)));
  console.log(
    `Seed complete: ${result.upsertedCount} inserted, ${result.modifiedCount} updated, ${result.matchedCount} already present.`,
  );
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (err: unknown) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    await mongoose.disconnect();
    process.exit(1);
  });
}
