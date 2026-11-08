import pino from 'pino';

/**
 * Central logging factory for all SRE Studio packages.
 *
 * Every module acquires its logger through this factory instead of
 * constructing pino instances directly, so log level, base fields, and
 * runtime behavior stay consistent and configurable in one place.
 *
 * Configuration (highest priority first):
 * - per-call `options.level`
 * - `SRE_LOG_LEVEL` environment variable (trace|debug|info|warn|error|fatal)
 * - default: `info`
 */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export function getLogLevel(): LogLevel {
  const raw = (process.env['SRE_LOG_LEVEL'] ?? '').toLowerCase();
  return isLogLevel(raw) ? raw : 'info';
}

export interface CreateLoggerOptions {
  /** Explicit level override; wins over `SRE_LOG_LEVEL`. */
  level?: LogLevel;
}

export function createLogger(loggerName: string, options?: CreateLoggerOptions): pino.Logger {
  return pino({
    name: loggerName,
    level: options?.level ?? getLogLevel()
  });
}

export type Logger = pino.Logger;
