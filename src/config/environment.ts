import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.url().default('http://localhost:3000'),
  MONGODB_URI: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Optional override; by default Claude is used when ANTHROPIC_API_KEY is set, else OpenAI. */
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['anthropic', 'openai']).optional()),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  ANTHROPIC_MODEL: z.preprocess(emptyToUndefined, z.string().default('claude-opus-5-5')),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENAI_MODEL: z.preprocess(emptyToUndefined, z.string().default('gpt-4o')),
  /** Assignment requirement: every LLM call times out after 8 seconds. */
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
});

export type Environment = z.infer<typeof EnvSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Report which variables are wrong without echoing their values.
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return parsed.data;
}
