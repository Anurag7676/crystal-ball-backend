import { createApp } from './app';
import { initDataLayer } from './config/database';
import { loadEnvironment } from './config/environment';
import { selectProvider } from './config/llmProvider';
import { LlmService } from './services/ai/openai.service';
import { loadPolicyChunks } from './services/rag/policy.service';
import { consoleLogger as logger } from './utils/logger';

async function main() {
  const env = loadEnvironment();
  const { approvals, conversations } = await initDataLayer({ mongoUri: env.MONGODB_URI, logger });

  const ai = selectProvider(env);
  if (!ai.provider) {
    logger.warn('No ANTHROPIC_API_KEY or OPENAI_API_KEY set — AI endpoints will return deterministic fallbacks only');
  }
  const llm = new LlmService(ai.provider, { timeoutMs: env.LLM_TIMEOUT_MS, idleTimeoutMs: env.LLM_TIMEOUT_MS });

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
      provider: ai.name,
      model: ai.model,
      approvals: approvals.source,
      conversations: conversations.source,
    });
  });
}

main().catch((err: unknown) => {
  logger.error('Failed to start', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
