import { z } from 'zod';

export const ApprovalTypeSchema = z.enum(['folder', 'video', 'pdf', 'image']);
export const ApprovalStatusSchema = z.enum(['pending_review', 'approved', 'rejected']);

export const ApprovalSchema = z.object({
  id: z.string().regex(/^apr-\d{3}$/),
  title: z.string().min(1),
  type: ApprovalTypeSchema,
  submittedBy: z.string().min(1),
  status: ApprovalStatusSchema,
  // The assignment gives "Sep 18" with no year, so we keep it as a display label, not a Date.
  submittedDateLabel: z.string().min(1),
});

export const ApprovalListSchema = z.array(ApprovalSchema);

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 10;

/** Accepts `?type=pdf,video`, `?type=pdf&type=video`, or nothing. */
const listParam = <T extends z.ZodType>(item: T, maxItems: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === '') return undefined;
      const parts = (Array.isArray(value) ? value : [value]).flatMap((v) => String(v).split(','));
      const cleaned = parts.map((p) => p.trim()).filter(Boolean);
      return cleaned.length ? cleaned : undefined;
    },
    z.array(item).max(maxItems).optional(),
  );

export const ApprovalQuerySchema = z
  .object({
    q: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(100).optional()),
    type: listParam(ApprovalTypeSchema, 4),
    submittedBy: listParam(z.string().min(1).max(80), 20),
    status: listParam(ApprovalStatusSchema, 3),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type ApprovalQuery = z.infer<typeof ApprovalQuerySchema>;

const FacetSchema = z.array(z.object({ value: z.string(), count: z.number().int().nonnegative() }));

export const ApprovalFacetsSchema = z.object({
  type: FacetSchema,
  submittedBy: FacetSchema,
  status: FacetSchema,
});

export const ApprovalPageSchema = z.object({
  approvals: ApprovalListSchema,
  /** Matching items across all pages. */
  total: z.number().int().nonnegative(),
  /** The page actually returned (clamped to the last page). */
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  pageCount: z.number().int().min(1),
  /** Pending items in the whole queue, independent of filters. */
  pendingCount: z.number().int().nonnegative(),
  /** Filter options with counts over the whole queue. */
  facets: ApprovalFacetsSchema,
});

export const ApprovalsResponseSchema = ApprovalPageSchema.extend({
  source: z.enum(['mongodb', 'fixture']),
});

export type Approval = z.infer<typeof ApprovalSchema>;
export type ApprovalFacets = z.infer<typeof ApprovalFacetsSchema>;
export type ApprovalPage = z.infer<typeof ApprovalPageSchema>;
export type ApprovalsResponse = z.infer<typeof ApprovalsResponseSchema>;
