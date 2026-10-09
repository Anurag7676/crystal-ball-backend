import type { RequestHandler, Response } from 'express';
import type { ZodError, ZodType } from 'zod';
import type { ErrorResponse } from '../schemas/ai.schema';

function rejectInvalid(res: Response, error: ZodError, what: string, root: string) {
  const body: ErrorResponse = {
    error: {
      code: 'validation_error',
      message: `${what} is invalid`,
      details: error.issues.map((issue) => ({ path: issue.path.join('.') || root, message: issue.message })),
    },
  };
  res.status(400).json(body);
}

/**
 * Validates `req.body` against a Zod schema and replaces it with the parsed (trimmed, typed)
 * value. Invalid requests get a JSON 400 and never reach the controller or the LLM.
 */
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return rejectInvalid(res, parsed.error, 'Request body', '(body)');
    req.body = parsed.data;
    next();
  };

/**
 * Validates the query string. Express 5 exposes `req.query` read-only, so the parsed value is
 * stored on `res.locals.query` for the controller.
 */
export const validateQuery =
  (schema: ZodType): RequestHandler =>
  (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return rejectInvalid(res, parsed.error, 'Query string', '(query)');
    res.locals.query = parsed.data;
    next();
  };
