import { z } from 'zod';
import {
  DoneEventSchema,
  ErrorEventSchema,
  ErrorResponseSchema,
  GreetingRequestSchema,
  MessageRequestSchema,
  MetaEventSchema,
  DeltaEventSchema,
  ResultEventSchema,
} from './ai.schema';
import { ApprovalsResponseSchema } from './approval.schema';

/**
 * The public HTTP contract as JSON Schema. `npm run contract:export` writes it to
 * contract/api-contract.json; the frontend keeps a copy and its contract test fails if its own
 * Zod schemas drift from it. No code is shared between the repos — only this document.
 */
export function buildContract() {
  const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input' });
  return {
    requests: {
      greeting: json(GreetingRequestSchema),
      summary: json(GreetingRequestSchema),
      chat: json(MessageRequestSchema),
      help: json(MessageRequestSchema),
      teach: json(MessageRequestSchema),
    },
    responses: {
      approvals: json(ApprovalsResponseSchema),
      error: json(ErrorResponseSchema),
    },
    sseEvents: {
      meta: json(MetaEventSchema),
      delta: json(DeltaEventSchema),
      result: json(ResultEventSchema),
      error: json(ErrorEventSchema),
      done: json(DoneEventSchema),
    },
  };
}
