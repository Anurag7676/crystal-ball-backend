import { createApp } from './app';
import { initDataLayer } from './config/database';
import { loadEnvironment } from './config/environment';
import { createOpenAiProvider, LlmService } from './services/ai/openai.service';
import { loadPolicyChunks } from './services/rag/policy.service';
import { consoleLogger as logger } from './utils/logger';

async function main() {
  const env = loadEnvironment();
  const { approvals, conversations } = await initDataLayer({ mongoUri: env.MONGODB_URI, logger });

  if (!env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — AI endpoints will return deterministic fallbacks only');
  }
  const provider = env.OPENAI_API_KEY
    ? createOpenAiProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL })
    : null;
  const llm = new LlmService(provider, { timeoutMs: env.LLM_TIMEOUT_MS, idleTimeoutMs: env.LLM_TIMEOUT_MS });

  const app = createApp({
    approvals,
    conversations,
    llm,
    policy: loadPolicyChunks(),
    frontendUrl: env.FRONTEND_URL,
    logger,
  });

  app.listen(env.PORT, () => {
    logger.info('API listening', {
      port: env.PORT,
      model: env.OPENAI_MODEL,
      approvals: approvals.source,
      conversations: conversations.source,
    });
  });
}

main().catch((err: unknown) => {
  logger.error('Failed to start', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
