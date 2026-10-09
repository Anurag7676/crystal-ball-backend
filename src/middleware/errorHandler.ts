import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ErrorResponse } from '../schemas/ai.schema';
import type { Logger } from '../utils/logger';

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ErrorResponse = { error: { code: 'not_found', message: 'Route not found' } };
  res.status(404).json(body);
};

interface HttpError {
  type?: string;
  status?: number;
}

/** Last-resort handler: always JSON, never a stack trace. */
export const createErrorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (err: unknown, req, res, next) => {
    if (res.headersSent) {
      // A streaming response already started; the SSE layer reports its own errors.
      next(err);
      return;
    }

    const httpErr = (err ?? {}) as HttpError;
    if (httpErr.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'validation_error', message: 'Request body is too large' } });
      return;
    }
    if (httpErr.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'validation_error', message: 'Request body is not valid JSON' } });
      return;
    }

    logger.error('Unhandled error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
    });
    const body: ErrorResponse = { error: { code: 'internal_error', message: 'Something went wrong' } };
    res.status(500).json(body);
  };
