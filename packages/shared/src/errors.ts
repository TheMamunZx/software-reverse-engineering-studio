export class SreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'SreError';
  }
}

export class AuthorizationError extends SreError {
  constructor(message: string, public readonly approvalNeeded: string[] = []) {
    super(message, 'AUTHORIZATION_DENIED', { approvalNeeded }, false);
    this.name = 'AuthorizationError';
  }
}

export class ProviderError extends SreError {
  constructor(message: string, public readonly providerId: string, details?: unknown, retryable = false) {
    super(message, 'PROVIDER_ERROR', { providerId, ...(details as object ?? {}) }, retryable);
    this.name = 'ProviderError';
  }
}

export class ValidationError extends SreError {
  constructor(message: string, public readonly field?: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', { field, ...(details as object ?? {}) }, false);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends SreError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', { resource, id }, false);
    this.name = 'NotFoundError';
  }
}

export class SessionNotFoundError extends NotFoundError {
  constructor(sessionId: string) {
    super('Session', sessionId);
    this.name = 'SessionNotFoundError';
  }
}

export class TargetNotFoundError extends NotFoundError {
  constructor(targetId: string) {
    super('Target', targetId);
    this.name = 'TargetNotFoundError';
  }
}

export class ProviderNotFoundError extends NotFoundError {
  constructor(providerId: string) {
    super('Provider', providerId);
    this.name = 'ProviderNotFoundError';
  }
}

export class ToolExecutionError extends SreError {
  constructor(
    public readonly tool: string,
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly command: string
  ) {
    super(`Tool ${tool} failed with exit code ${exitCode}: ${stderr}`, 'TOOL_EXECUTION_ERROR', {
      tool,
      exitCode,
      stderr,
      command
    }, true);
    this.name = 'ToolExecutionError';
  }
}

export class ConfigurationError extends SreError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIGURATION_ERROR', details, false);
    this.name = 'ConfigurationError';
  }
}

export class InternalError extends SreError {
  constructor(message: string, details?: unknown) {
    super(message, 'INTERNAL_ERROR', details, false);
    this.name = 'InternalError';
  }
}

export function isSreError(error: unknown): error is SreError {
  return error instanceof SreError;
}

export function toSreError(error: unknown): SreError {
  if (isSreError(error)) return error;
  if (error instanceof Error) {
    return new InternalError(error.message, { stack: error.stack, cause: error.cause });
  }
  return new InternalError(String(error));
}