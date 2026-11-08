import { describe, expect, it } from 'vitest';
import {
  SreError,
  ValidationError,
  ConfigurationError,
  InternalError,
  ProviderError,
  AuthorizationError,
  NotFoundError,
  SessionNotFoundError,
  ToolExecutionError,
  isSreError,
  toSreError
} from '../src/errors.js';

describe('SreError', () => {
  it('exposes code, details and retryable semantics', () => {
    const error = new SreError('something failed', 'TEST_CODE', { attempt: 2 }, true);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('something failed');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual({ attempt: 2 });
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('SreError');
  });

  it('defaults to non-retryable', () => {
    const error = new SreError('boom', 'TEST_CODE');
    expect(error.retryable).toBe(false);
  });
});

describe('error classification helpers', () => {
  it('detects SreError instances', () => {
    expect(isSreError(new SreError('x', 'A'))).toBe(true);
    expect(isSreError(new Error('plain'))).toBe(false);
    expect(isSreError(null)).toBe(false);
  });

  it('wraps foreign errors into InternalError', () => {
    const original = new Error('network down');
    const wrapped = toSreError(original);
    expect(wrapped).toBeInstanceOf(InternalError);
    expect(wrapped.message).toBe('network down');
    expect(wrapped.code).toBe('INTERNAL_ERROR');
  });

  it('returns SreError instances untouched', () => {
    const original = new ValidationError('bad input', 'name');
    expect(toSreError(original)).toBe(original);
  });

  it('handles non-Error throwables', () => {
    const wrapped = toSreError('oops');
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.message).toBe('oops');
  });
});

describe('specialized errors', () => {
  it('ValidationError carries field and details', () => {
    const error = new ValidationError('must not be empty', 'target.path', { got: '' });
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.field).toBe('target.path');
    expect(error.details).toEqual({ field: 'target.path', got: '' });
    expect(error.retryable).toBe(false);
  });

  it('AuthorizationError lists required approvals', () => {
    const error = new AuthorizationError('needs approval', ['dynamic-execution']);
    expect(error.code).toBe('AUTHORIZATION_DENIED');
    expect(error.approvalNeeded).toEqual(['dynamic-execution']);
  });

  it('ProviderError carries providerId', () => {
    const error = new ProviderError('tool crashed', 'binary-provider', { exitCode: 2 }, true);
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.providerId).toBe('binary-provider');
    expect(error.retryable).toBe(true);
  });

  it('NotFoundError forms a readable message and subclass chain', () => {
    const error = new SessionNotFoundError('ses_0123456789abcdef');
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toBeInstanceOf(SreError);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain('ses_0123456789abcdef');
  });

  it('ToolExecutionError records tool output and is retryable', () => {
    const error = new ToolExecutionError('rizin', 2, 'no such file', 'rizin -qc izz a.exe');
    expect(error.code).toBe('TOOL_EXECUTION_ERROR');
    expect(error.tool).toBe('rizin');
    expect(error.exitCode).toBe(2);
    expect(error.retryable).toBe(true);
  });

  it('ConfigurationError uses the configuration code', () => {
    expect(new ConfigurationError('bad yaml').code).toBe('CONFIGURATION_ERROR');
  });
});
