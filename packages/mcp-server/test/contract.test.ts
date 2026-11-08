import { beforeAll, describe, expect, it } from 'vitest';
import { loadValidators, validateInput, validateOutput, getValidator } from '../src/validation/validators.js';
import { createAjv } from '@sre-studio/shared';
import { promises as fs } from 'node:fs';
import path from 'node:path';

beforeAll(async () => {
  await loadValidators();
});

const toolNames = [
  'investigation.start',
  'investigation.status',
  'investigation.close',
  'target.register',
  'target.list',
  'analysis.run',
  'analysis.capabilities',
  'evidence.query'
] as const;

describe('MCP tool contract tests — schema validation', () => {
  it('registers validators for all 8 MCP tool inputs and results', () => {
    for (const tool of toolNames) {
      expect(getValidator(tool), `${tool} input validator`).toBeDefined();
      expect(getValidator(`${tool}.result`), `${tool}.result validator`).toBeDefined();
    }
    expect(getValidator('unknown.tool')).toBeUndefined();
    expect(getValidator('unknown.tool.result')).toBeUndefined();
  });

  describe('investigation.start', () => {
    it('accepts valid input payload', () => {
      const payload = {
        target: { type: 'binary', path: 'C:/targets/sample.exe' },
        scope: 'Static analysis of owned binary',
        authorization: {
          type: 'owner',
          description: 'Owner-authorized testing',
          documentRef: '/docs/auth.md'
        },
        config: { providers: ['binary-provider'] }
      };
      expect(() => validateInput('investigation.start', payload)).not.toThrow();
    });

    it('rejects missing required fields', () => {
      const payload = {
        target: { type: 'binary', path: 'C:/targets/sample.exe' },
        scope: 'Static analysis'
        // missing authorization
      };
      expect(() => validateInput('investigation.start', payload)).toThrow(/Validation failed/);
    });

    it('rejects invalid target type enum', () => {
      const payload = {
        target: { type: 'invalid', path: 'C:/targets/sample.exe' },
        scope: 'test',
        authorization: { type: 'owner', description: 'test' }
      };
      expect(() => validateInput('investigation.start', payload)).toThrow(/Validation failed/);
    });

    it('rejects unknown extra properties', () => {
      const payload = {
        target: { type: 'binary', path: 'C:/targets/sample.exe', extra: true },
        scope: 'test',
        authorization: { type: 'owner', description: 'test' }
      };
      expect(() => validateInput('investigation.start', payload)).toThrow(/Validation failed/);
    });
  });

  describe('investigation.status', () => {
    it('accepts valid input', () => {
      expect(() => validateInput('investigation.status', { sessionId: 'ses_0123456789abcdef' })).not.toThrow();
    });

    it('rejects invalid sessionId pattern', () => {
      expect(() => validateInput('investigation.status', { sessionId: 'invalid-id' })).toThrow(/Validation failed/);
    });
  });

  describe('investigation.close', () => {
    it('accepts valid input', () => {
      expect(() => validateInput('investigation.close', { sessionId: 'ses_0123456789abcdef', reason: 'completed' })).not.toThrow();
    });

    it('rejects invalid reason enum', () => {
      expect(() => validateInput('investigation.close', { sessionId: 'ses_0123456789abcdef', reason: 'invalid' })).toThrow(/Validation failed/);
    });
  });

  describe('target.register', () => {
    it('accepts valid input', () => {
      const payload = {
        sessionId: 'ses_0123456789abcdef',
        target: { type: 'binary', path: 'C:/targets/sample.exe' },
        authorization: { type: 'owner', description: 'Owner-authorized' }
      };
      expect(() => validateInput('target.register', payload)).not.toThrow();
    });

    it('rejects missing target.path', () => {
      const payload = {
        sessionId: 'ses_0123456789abcdef',
        target: { type: 'binary' },
        authorization: { type: 'owner', description: 'test' }
      };
      expect(() => validateInput('target.register', payload)).toThrow(/Validation failed/);
    });
  });

  describe('target.list', () => {
    it('accepts valid input with no filters', () => {
      expect(() => validateInput('target.list', { sessionId: 'ses_0123456789abcdef' })).not.toThrow();
    });

    it('accepts valid input with type filter', () => {
      expect(() => validateInput('target.list', { sessionId: 'ses_0123456789abcdef', filter: { type: 'binary' } })).not.toThrow();
    });
  });

  describe('analysis.run', () => {
    it('accepts valid input', () => {
      const payload = {
        sessionId: 'ses_0123456789abcdef',
        capabilityId: 'binary.info',
        parameters: { includeImports: true }
      };
      expect(() => validateInput('analysis.run', payload)).not.toThrow();
    });

    it('rejects invalid capabilityId pattern', () => {
      const payload = {
        sessionId: 'ses_0123456789abcdef',
        capabilityId: 'invalid.capability'
      };
      expect(() => validateInput('analysis.run', payload)).toThrow(/Validation failed/);
    });
  });

  describe('analysis.capabilities', () => {
    it('accepts valid input', () => {
      expect(() => validateInput('analysis.capabilities', { sessionId: 'ses_0123456789abcdef' })).not.toThrow();
    });

    it('accepts input with no properties', () => {
      expect(() => validateInput('analysis.capabilities', {})).not.toThrow();
    });
  });

  describe('evidence.query', () => {
    it('accepts valid input', () => {
      expect(() => validateInput('evidence.query', { sessionId: 'ses_0123456789abcdef' })).not.toThrow();
    });

    it('accepts input with filters and pagination', () => {
      const payload = {
        sessionId: 'ses_0123456789abcdef',
        filter: { category: 'code', confidenceMin: 0.8 },
        pagination: { limit: 10, offset: 0 }
      };
      expect(() => validateInput('evidence.query', payload)).not.toThrow();
    });

    it('rejects invalid confidenceMin range', () => {
      const payload = {
        sessionId: 'ses_0123456789abcdef',
        filter: { confidenceMin: 1.5 }
      };
      expect(() => validateInput('evidence.query', payload)).toThrow(/Validation failed/);
    });
  });

  describe('unknown tool names', () => {
    it('fails fast for unknown input tool', () => {
      expect(() => validateInput('unknown.tool', {})).toThrow(/No validator found/);
    });

    it('fails fast for unknown output tool', () => {
      expect(() => validateOutput('unknown.tool.result', {})).toThrow(/No result validator found/);
    });
  });
});
