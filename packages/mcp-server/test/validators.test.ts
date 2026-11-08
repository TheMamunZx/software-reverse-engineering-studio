import { beforeAll, describe, expect, it } from 'vitest';
import { loadValidators, validateInput, validateOutput, getValidator } from '../src/validation/validators.js';

beforeAll(async () => {
  await loadValidators();
});

describe('schema-backed validation', () => {
  it('registers validators for every MCP tool input and result schema', () => {
    for (const tool of ['investigation.start', 'investigation.status', 'investigation.close', 'target.register', 'target.list', 'analysis.run', 'analysis.capabilities', 'evidence.query']) {
      expect(getValidator(tool), tool).toBeDefined();
      expect(getValidator(`${tool}.result`), `${tool}.result`).toBeDefined();
    }
    expect(getValidator('unknown.tool')).toBeUndefined();
  });

  it('accepts a valid investigation.start payload', () => {
    const payload = {
      target: { type: 'binary', path: 'C:/targets/sample.exe' },
      scope: 'Static analysis of owned binary',
      authorization: {
        type: 'owner',
        description: 'Sample fixture generated for this repo'
      },
      config: { providers: ['binary-provider'] }
    };
    expect(() => validateInput('investigation.start', payload)).not.toThrow();
  });

  it('rejects an investigation.start payload missing required fields', () => {
    const payload = {
      target: { type: 'binary', path: 'C:/targets/sample.exe' },
      scope: 'Static analysis of owned binary'
    };
    expect(() => validateInput('investigation.start', payload)).toThrow(/Validation failed for investigation\.start/);
  });

  it('rejects payloads with unknown extra properties', () => {
    const payload = {
      target: { type: 'binary', path: 'C:/targets/sample.exe', extra: true },
      scope: 'Static analysis of owned binary',
      authorization: { type: 'owner', description: 'owned' }
    };
    expect(() => validateInput('investigation.start', payload)).toThrow(/Validation failed for investigation\.start/);
  });

  it('validates a complete investigation.status result', () => {
    const result = {
      sessionId: 'ses_0123456789abcdef',
      status: 'running',
      progress: { totalSteps: 3, completedSteps: 1, findingsCount: 0, evidenceCount: 0, errors: [] },
      findingsCount: 0
    };
    expect(() => validateOutput('investigation.status', result)).not.toThrow();
  });

  it('rejects malformed results for known tools', () => {
    const malformed = { sessionId: 'ses_bad', status: 'running', progress: {}, findingsCount: 0 };
    expect(() => validateOutput('investigation.status', malformed)).toThrow(/Output validation failed for investigation\.status/);
  });

  it('fails fast for unknown tool names', () => {
    expect(() => validateInput('unknown.tool', {})).toThrow(/No validator found for tool: unknown\.tool/);
    expect(() => validateOutput('unknown.tool', {})).toThrow(/No result validator found for tool: unknown\.tool/);
  });
});
