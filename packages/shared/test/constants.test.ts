import { describe, expect, it } from 'vitest';
import {
  generateId,
  isValidFindingCategory,
  isValidSeverity,
  isValidConfidenceLevel,
  isValidSessionStatus,
  isValidTargetType,
  SRE_STUDIO_VERSION,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  DEFAULT_RESOURCE_LIMITS
} from '../src/constants.js';

describe('generateId', () => {
  it('uses the documented prefixes', () => {
    expect(generateId('session')).toMatch(/^ses_[0-9a-f]{16}$/);
    expect(generateId('target')).toMatch(/^tgt_[0-9a-f]{16}$/);
    expect(generateId('finding')).toMatch(/^fnd_[0-9a-f]{16}$/);
    expect(generateId('provider')).toMatch(/^prv_[0-9a-f]{16}$/);
    expect(generateId('environment')).toMatch(/^env_[0-9a-f]{16}$/);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateId('finding')));
    expect(ids.size).toBe(200);
  });
});

describe('domain type guards', () => {
  it('accepts valid values and rejects invalid ones', () => {
    expect(isValidFindingCategory('structure')).toBe(true);
    expect(isValidFindingCategory('unknown')).toBe(false);
    expect(isValidSeverity('high')).toBe(true);
    expect(isValidSeverity('catastrophic')).toBe(false);
    expect(isValidConfidenceLevel('none')).toBe(true);
    expect(isValidConfidenceLevel('certain')).toBe(false);
    expect(isValidSessionStatus('initialized')).toBe(true);
    expect(isValidSessionStatus('open')).toBe(false);
    expect(isValidTargetType('binary')).toBe(true);
    expect(isValidTargetType('firmware')).toBe(false);
  });
});

describe('package-wide constants', () => {
  it('keeps stable package and protocol markers', () => {
    expect(SRE_STUDIO_VERSION).toBe('0.1.0');
    expect(MCP_SERVER_NAME).toBe('sre-studio');
    expect(MCP_PROTOCOL_VERSION).toBeTruthy();
  });

  it('defines non-trivial default resource limits', () => {
    expect(DEFAULT_RESOURCE_LIMITS.maxMemoryMb).toBeGreaterThan(0);
    expect(DEFAULT_RESOURCE_LIMITS.maxCpuPercent).toBeGreaterThan(0);
    expect(DEFAULT_RESOURCE_LIMITS.maxCpuPercent).toBeLessThanOrEqual(100);
    expect(DEFAULT_RESOURCE_LIMITS.maxDurationMs).toBeGreaterThan(0);
    expect(DEFAULT_RESOURCE_LIMITS.maxConcurrentAnalyses).toBeGreaterThan(0);
    expect(DEFAULT_RESOURCE_LIMITS.maxDiskUsageMb).toBeGreaterThan(0);
  });
});
