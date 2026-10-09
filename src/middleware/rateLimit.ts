import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ErrorResponse } from '../schemas/ai.schema';

export interface RateLimitConfig {
  /** Coarse per-IP ceiling across all AI endpoints (stops session-id rotation). */
  ipPerMinute: number;
  /** Per-session budget for AI calls. */
  sessionPerMinute: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = { ipPerMinute: 60, sessionPerMinute: 20 };

const limitedBody: ErrorResponse = {
  error: { code: 'rate_limited', message: 'Too many AI requests. Please wait a moment and try again.' },
};

/**
 * Two layers: per-IP first (before validation), then per-session (after validation, so the
 * session id is known to be well-formed). Session ids are client-generated and NOT a security
 * boundary — the IP limiter is what bounds a client that rotates ids.
 * Uses the in-memory store: fine for a single instance, would need Redis behind a load balancer.
 */
export function createAiRateLimiters(config: RateLimitConfig): { perIp: RequestHandler; perSession: RequestHandler } {
  const common = {
    windowMs: 60_000,
    standardHeaders: 'draft-8' as const,
    legacyHeaders: false,
    handler: (_req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => {
      res.status(429).json(limitedBody);
    },
  };

  return {
    perIp: rateLimit({ ...common, limit: config.ipPerMinute }),
    perSession: rateLimit({
      ...common,
      limit: config.sessionPerMinute,
      keyGenerator: (req) => `session:${String(req.body?.sessionId)}`,
    }),
  };
}
