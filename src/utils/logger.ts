export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const write =
  (level: 'info' | 'warn' | 'error') =>
  (message: string, meta?: Record<string, unknown>) => {
    const line = JSON.stringify({ level, message, ...meta, time: new Date().toISOString() });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

/** Structured JSON logger. Callers must never pass secrets (API keys, connection strings). */
export const consoleLogger: Logger = { info: write('info'), warn: write('warn'), error: write('error') };
