import { z } from 'zod';

export const MAX_MESSAGE_LENGTH = 1000;

export const AiActionSchema = z.enum(['greeting', 'summary', 'chat', 'help', 'teach']);
export type AiAction = z.infer<typeof AiActionSchema>;

/**
 * Client-generated, opaque session id. Used only to group conversation history and to key
 * rate limits — it is NOT an authentication credential.
 */
export const SessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid session id');

/** BCP-47-ish language tag, e.g. "en", "hi-IN", "es-419". */
export const LanguageSchema = z
  .string()
  .max(35)
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Invalid language tag');

// ---------- Requests ----------

export const GreetingRequestSchema = z
  .object({ sessionId: SessionIdSchema, language: LanguageSchema.optional() })
  .strict();

export const SummaryRequestSchema = GreetingRequestSchema;

export const MessageRequestSchema = z
  .object({
    sessionId: SessionIdSchema,
    language: LanguageSchema.optional(),
    message: z.string().trim().min(1, 'Message is required').max(MAX_MESSAGE_LENGTH),
  })
  .strict();

export const ChatRequestSchema = MessageRequestSchema;
export const HelpRequestSchema = MessageRequestSchema;
export const TeachRequestSchema = MessageRequestSchema;

export type GreetingRequest = z.infer<typeof GreetingRequestSchema>;
export type SummaryRequest = z.infer<typeof SummaryRequestSchema>;
export type MessageRequest = z.infer<typeof MessageRequestSchema>;

// ---------- Structured summary ----------

/** Exactly what GPT-4o must return for "Present me Summary". Validated before anything else. */
export const SummaryModelOutputSchema = z
  .object({
    pendingCount: z.number().int().nonnegative(),
    overview: z.string().min(1).max(800),
    priorityItems: z
      .array(z.object({ approvalId: z.string().min(1), reason: z.string().min(1).max(400) }).strict())
      .min(1)
      .max(10),
    // Optional tips: an empty list is a weaker summary, not an untrustworthy one.
    recommendations: z.array(z.string().min(1).max(400)).max(5),
  })
  .strict();

export type SummaryModelOutput = z.infer<typeof SummaryModelOutputSchema>;

/** Same contract as JSON Schema, for providers that constrain decoding to a schema. */
export const SUMMARY_OUTPUT_JSON_SCHEMA = z.toJSONSchema(SummaryModelOutputSchema) as Record<string, unknown>;

/** What the API sends to the UI: model output + server-side facts (titles, ordering note). */
export const SummarySchema = z.object({
  pendingCount: z.number().int().nonnegative(),
  overview: z.string().min(1),
  priorityItems: z.array(
    z.object({ approvalId: z.string(), title: z.string(), reason: z.string() }),
  ),
  recommendations: z.array(z.string()),
  orderingNote: z.string(),
});

export type Summary = z.infer<typeof SummarySchema>;

// ---------- SSE events ----------

export const FallbackReasonSchema = z.enum([
  'timeout',
  'provider_error',
  'missing_api_key',
  'invalid_output',
]);
export type FallbackReason = z.infer<typeof FallbackReasonSchema>;

export const MetaEventSchema = z.object({
  action: AiActionSchema,
  requestId: z.string(),
  /** Policy chunk ids retrieved for help/teach (deterministic, not model-generated). */
  sources: z.array(z.string()).optional(),
});

export const DeltaEventSchema = z.object({ text: z.string() });

/**
 * `text` replaces whatever deltas were shown so far (used when a stream fails midway and we
 * substitute a fallback). `summary` carries a validated structured summary.
 */
export const ResultEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('summary'), summary: SummarySchema }),
]);

export const ErrorCodeSchema = z.enum([
  'validation_error',
  'rate_limited',
  'not_found',
  'ai_unavailable',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorEventSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
});

export const DoneEventSchema = z.object({
  source: z.enum(['ai', 'fallback']),
  fallbackReason: FallbackReasonSchema.optional(),
  /** Chunk ids the model cited that were actually retrieved (help/teach only). */
  citedSources: z.array(z.string()).optional(),
});

export const SseEventSchemas = {
  meta: MetaEventSchema,
  delta: DeltaEventSchema,
  result: ResultEventSchema,
  error: ErrorEventSchema,
  done: DoneEventSchema,
} as const;

export type SseEventName = keyof typeof SseEventSchemas;
export type SseEventPayload<E extends SseEventName> = z.infer<(typeof SseEventSchemas)[E]>;

// ---------- JSON error body (non-stream responses) ----------

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
