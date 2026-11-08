import { afterEach, describe, expect, it } from 'vitest';
import { createLogger, getLogLevel, isLogLevel } from '../src/logger.js';

const ORIGINAL_LEVEL = process.env['SRE_LOG_LEVEL'];

afterEach(() => {
  if (ORIGINAL_LEVEL === undefined) {
    delete process.env['SRE_LOG_LEVEL'];
  } else {
    process.env['SRE_LOG_LEVEL'] = ORIGINAL_LEVEL;
  }
});

describe('getLogLevel', () => {
  it('defaults to info', () => {
    delete process.env['SRE_LOG_LEVEL'];
    expect(getLogLevel()).toBe('info');
  });

  it('honors the SRE_LOG_LEVEL override (case-insensitive)', () => {
    process.env['SRE_LOG_LEVEL'] = 'DEBUG';
    expect(getLogLevel()).toBe('debug');
  });

  it('falls back to info for unknown levels', () => {
    process.env['SRE_LOG_LEVEL'] = 'verbose';
    expect(getLogLevel()).toBe('info');
  });
});

describe('isLogLevel', () => {
  it('recognizes the supported levels', () => {
    expect(isLogLevel('trace')).toBe(true);
    expect(isLogLevel('fatal')).toBe(true);
    expect(isLogLevel('warning')).toBe(false);
    expect(isLogLevel(42)).toBe(false);
  });
});

describe('createLogger', () => {
  it('uses the configured default level', () => {
    delete process.env['SRE_LOG_LEVEL'];
    const logger = createLogger({ name: 'test-suite' });
    expect(logger.level).toBe('info');
  });

  it('honors an explicit level over the environment', () => {
    process.env['SRE_LOG_LEVEL'] = 'error';
    const logger = createLogger('test-suite', { level: 'debug' });
    expect(logger.level).toBe('debug');
  });

  it('carries the logger name into the pino instance', () => {
    const logger = createLogger('audit-pinned', { level: 'info' });
    expect(logger.bindings()).toMatchObject({ name: 'audit-pinned' });
  });
});
