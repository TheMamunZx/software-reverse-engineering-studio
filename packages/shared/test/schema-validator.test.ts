import { describe, expect, it } from 'vitest';
import { createValidator, createAjv } from '../src/utils.js';
import { ValidationError } from '../src/errors.js';
import { loadSchemaFile } from '../src/schemas/index.js';

const dateTimeSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://sre-studio.dev/schemas/test/datetime.json',
  version: '1.0.0',
  type: 'object',
  required: ['capturedAt'],
  additionalProperties: false,
  properties: {
    capturedAt: { type: 'string', format: 'date-time' }
  }
} as const;

describe('createValidator', () => {
  it('passes schema-valid data through', () => {
    const validator = createValidator<{ capturedAt: string }>(dateTimeSchema);
    const input = { capturedAt: '2026-11-08T12:00:00Z' };
    expect(validator.validate(input)).toEqual(input);
    expect(validator.validateOrThrow(input)).toEqual(input);
  });

  it('rejects invalid payloads with a typed ValidationError', () => {
    const validator = createValidator(dateTimeSchema);
    expect(() => validator.validate({ capturedAt: 'not-a-date' })).toThrow(ValidationError);
    try {
      validator.validate({ capturedAt: 'not-a-date' });
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as ValidationError).code).toBe('VALIDATION_ERROR');
      expect((error as ValidationError).message).toContain('Validation failed');
      expect((error as ValidationError).details).toBeDefined();
    }
  });

  it('enforces additionalProperties: false', () => {
    const validator = createValidator(dateTimeSchema);
    expect(() => validator.validate({ capturedAt: '2026-11-08T12:00:00Z', extra: 1 })).toThrow(ValidationError);
  });

  it('rejects missing required fields', () => {
    const validator = createValidator(dateTimeSchema);
    expect(() => validator.validate({})).toThrow(ValidationError);
  });

  it('compiles schemas carrying the custom version root field', () => {
    // `version` is the versioning marker of the schema infrastructure and must
    // not be treated as an unknown keyword in strict mode.
    const validator = createValidator({ ...dateTimeSchema, version: '2.1.3' });
    expect(validator.validate({ capturedAt: '2026-11-08T12:00:00Z' })).toEqual({ capturedAt: '2026-11-08T12:00:00Z' });
  });
});

describe('schema infrastructure integration', () => {
  it('validates real schemas from the versioned schema registry', async () => {
    const schema = await loadSchemaFile('mcpTools', 'investigation.status');
    const validator = createValidator(schema);
    const result = validator.validate({ sessionId: 'ses_0123456789abcdef' });
    expect(result).toHaveProperty('sessionId', 'ses_0123456789abcdef');
    expect(() => validator.validate({ sessionId: 'not-a-session-id' })).toThrow(ValidationError);
    expect(() => validator.validate({ sessionId: 'ses_0123456789abcdef', extra: true })).toThrow(ValidationError);
  });
});

describe('createAjv', () => {
  it('exposes a draft 2020-12 instance usable for repeated compiles', () => {
    const ajv = createAjv();
    const first = ajv.compile(dateTimeSchema);
    expect(first({ capturedAt: 'nope' })).toBe(false);
    // Capture the error text right after the failing validation: Ajv stores
    // last-validation errors per instance, so later runs clear the reference.
    expect(ajv.errorsText(first.errors as any)).toContain('must match');
    expect(first.errors).not.toBeNull();

    const second = ajv.compile(dateTimeSchema);
    expect(second({ capturedAt: '2026-11-08T12:00:00Z' })).toBe(true);
    expect(first({ capturedAt: '2026-11-08T12:00:00Z' })).toBe(true);
    expect(first({ capturedAt: 'nope' })).toBe(false);
  });
});
