import { Router } from 'express';
import { type AiControllerDeps, createAiController } from '../controllers/ai.controller';
import { createAiRateLimiters, type RateLimitConfig } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import {
  ChatRequestSchema,
  GreetingRequestSchema,
  HelpRequestSchema,
  SummaryRequestSchema,
  TeachRequestSchema,
} from '../schemas/ai.schema';

/**
 * Every AI route: per-IP limit → Zod validation → per-session limit → controller.
 * Anything that fails before the controller gets a JSON error; after that, errors travel as SSE events.
 */
export function createAiRouter(deps: AiControllerDeps, rateLimits: RateLimitConfig): Router {
  const router = Router();
  const controller = createAiController(deps);
  const { perIp, perSession } = createAiRateLimiters(rateLimits);

  router.use(perIp);
  router.post('/greeting', validateBody(GreetingRequestSchema), perSession, controller.greeting);
  router.post('/summary', validateBody(SummaryRequestSchema), perSession, controller.summary);
  router.post('/chat', validateBody(ChatRequestSchema), perSession, controller.chat);
  router.post('/help', validateBody(HelpRequestSchema), perSession, controller.help);
  router.post('/teach', validateBody(TeachRequestSchema), perSession, controller.teach);
  return router;
}
