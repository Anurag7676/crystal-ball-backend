import cors from 'cors';
import express, { type Express } from 'express';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { DEFAULT_RATE_LIMITS, type RateLimitConfig } from './middleware/rateLimit';
import type { ApprovalRepository } from './repositories/approval.repository';
import type { ConversationRepository } from './repositories/conversation.repository';
import { createAiRouter } from './routes/ai.routes';
import { createApprovalsRouter } from './routes/approvals.routes';
import type { LlmService } from './services/ai/openai.service';
import type { PolicyChunk } from './services/rag/policy.service';
import { consoleLogger, type Logger } from './utils/logger';

export interface AppDeps {
  approvals: ApprovalRepository;
  conversations: ConversationRepository;
  llm: LlmService;
  policy: PolicyChunk[];
  frontendUrl: string;
  rateLimits?: RateLimitConfig;
  logger?: Logger;
}

/** Builds the Express app without listening, so Supertest can drive it directly. */
export function createApp(deps: AppDeps): Express {
  const logger = deps.logger ?? consoleLogger;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Reflect the origin only when it is the configured frontend; other origins get no CORS headers.
  app.use(
    cors({ origin: (origin, cb) => cb(null, origin === deps.frontendUrl), methods: ['GET', 'POST'] }),
  );
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', ai: deps.llm.isConfigured ? 'configured' : 'fallback-only' });
  });
  app.use('/api/approvals', createApprovalsRouter(deps.approvals));
  app.use('/api/ai', createAiRouter({ ...deps, logger }, deps.rateLimits ?? DEFAULT_RATE_LIMITS));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
