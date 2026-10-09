import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import type { ErrorResponse } from '../schemas/ai.schema';

/**
 * Validates `req.body` against a Zod schema and replaces it with the parsed (trimmed, typed)
 * value. Invalid requests get a JSON 400 and never reach the controller or the LLM.
 */
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const body: ErrorResponse = {
        error: {
          code: 'validation_error',
          message: 'Request body is invalid',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.') || '(body)',
            message: issue.message,
          })),
        },
      };
      res.status(400).json(body);
      return;
    }
    req.body = parsed.data;
    next();
  };
