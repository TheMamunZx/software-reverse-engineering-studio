import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Repository } from '../src/storage/repository.js';
import { EvidenceEngine } from '../src/evidence/evidence-engine.js';
import { ValidationError, NotFoundError } from '@sre-studio/shared';
import type {
  AuthorizationRecord,
  InvestigationSession,
  SessionConfig,
  SessionProgress
} from '../src/types/investigation.js';
import type {
  Finding,
  ConfidenceScore,
  ConfidenceFactor,
  EvidenceReference,
  ProvenanceInfo,
  ReproducibilityInfo
} from '../src/types/evidence.js';

interface TempDbHandle {
  directory: string;
  repository: Repository;
}

let handle: TempDbHandle;
const extraRepos: Array<{ close(): void; cleanup(): void }> = [];

function createTempRepository(label: string): TempDbHandle {
  const directory = mkdtempSync(path.join(tmpdir(), `sre-studio-evidence-${label}-`));
  const repository = new Repository({ dbPath: path.join(directory, 'investigation.db') });
  return { directory, repository };
}

beforeAll(() => {
  handle = createTempRepository('main');
});

afterAll(() => {
  handle.repository.close();
  rmSync(handle.directory, { recursive: true, force: true });
  for (const entry of extraRepos) {
    entry.close();
    entry.cleanup();
  }
});

const authorization: AuthorizationRecord = {
  type: 'owner',
  description: 'Evidence engine test authorization',
  scope: ['C:/targets/sample.exe'],
  limitations: [],
  verified: true
};

const sessionConfig: SessionConfig = {
  providers: [],
  resourceLimits: {
    maxMemoryMb: 4096,
    maxCpuPercent: 80,
    maxDurationMs: 300000,
    maxConcurrentAnalyses: 10,
    maxDiskUsageMb: 2048
  }
};

const defaultProgress: SessionProgress = {
  totalSteps: 0,
  completedSteps: 0,
  findingsCount: 0,
  evidenceCount: 0,
  errors: []
};

function makeEvidenceEngine(): EvidenceEngine {
  return new EvidenceEngine({ repository: handle.repository });
}

function createSessionAndTarget(): { sessionId: string; targetId: string; envId: string } {
  const session = handle.repository.createSession({
    projectId: 'proj_ev',
    name: 'Evidence test session',
    targets: [],
    authorization,
    status: 'initialized',
    progress: defaultProgress,
    config: sessionConfig,
    createdBy: 'ev-test',
    tags: []
  });
  const target = handle.repository.registerTarget(session.id, {
    type: 'binary',
    path: 'C:/targets/sample.exe',
    metadata: {},
    hashes: { sha256: 'h'.repeat(64) },
    authorization,
    role: 'primary'
  });
  const env = handle.repository.createEnvironment({
    sessionId: session.id,
    os: process.platform,
    arch: process.arch,
    tools: [],
    providerVersions: {},
    targetHash: 'e'.repeat(64)
  });
  return { sessionId: session.id, targetId: target.id, envId: env.id };
}

function baseFindingInput(ctx: { sessionId?: string; targetId?: string; envId?: string } = {}, overrides: Record<string, unknown> = {}): Omit<Finding, 'id' | 'createdAt' | 'updatedAt' | 'version'> {
  let sessionId = ctx.sessionId;
  let targetId = ctx.targetId;
  let envId = ctx.envId;

  if (!sessionId || !targetId || !envId) {
    const created = createSessionAndTarget();
    sessionId = sessionId ?? created.sessionId;
    targetId = targetId ?? created.targetId;
    envId = envId ?? created.envId;
  }

  return {
    sessionId,
    targetId,
    providerId: 'test-provider',
    capabilityId: 'test.capability',
    category: 'structure' as const,
    severity: 'info' as const,
    title: 'Test finding',
    observation: 'Test observation',
    evidence: [],
    confidence: {
      level: 'medium' as const,
      value: 0.5,
      justification: 'Test justification',
      factors: []
    },
    limitations: [],
    unknowns: [],
    provenance: {
      derivedFrom: [],
      tool: 'test-tool',
      command: 'test-tool --scan',
      parameters: {},
      duration: 10,
      toolVersion: '1.0.0'
    },
    reproducibility: {
      reproducible: true,
      environmentId: envId,
      steps: [],
      knownVariations: []
    },
    tags: [],
    createdBy: 'ev-test',
    ...overrides
  } as Omit<Finding, 'id' | 'createdAt' | 'updatedAt' | 'version'>;
}

describe('EvidenceEngine — createFinding', () => {
  let engine: EvidenceEngine;

  beforeAll(() => {
    engine = makeEvidenceEngine();
  });

  it('creates and persists a finding with all fields', () => {
    const input = baseFindingInput();
    const created = engine.createFinding(input);

    expect(created.id).toMatch(/^fnd_[0-9a-f]{16}$/);
    expect(created.version).toBe(1);
    expect(created.sessionId).toBe(input.sessionId);
    expect(created.targetId).toBe(input.targetId);
    expect(created.title).toBe('Test finding');
    expect(created.confidence.level).toBe('medium');
    expect(created.confidence.value).toBe(0.5);
    expect(created.provenance.tool).toBe('test-tool');
    expect(created.reproducibility.reproducible).toBe(true);

    // Read back from SQLite
    const loaded = engine.getFinding(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.observation).toBe('Test observation');
  });

  it('round-trips evidence references with hashes', () => {
    const ref = engine.createEvidenceReference({
      type: 'tool-output' as const,
      location: { file: 'sample.exe', offset: 0x100, length: 64 },
      excerpt: 'MZ\x90\x00\x03',
      tool: 'rizin'
    });
    expect(ref.hash).toBeDefined();
    expect(ref.hash.length).toBeGreaterThan(0);

    const input = baseFindingInput({}, { evidence: [ref] });
    const created = engine.createFinding(input);
    expect(created.evidence).toHaveLength(1);
    expect(created.evidence[0].hash).toBe(ref.hash);
  });

  it('round-trips confidence factors', () => {
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'Exit code 0', weight: 1.0 },
      { name: 'parse-success', impact: 'positive', description: 'Output parsed cleanly', weight: 1.0 }
    ];
    const input = baseFindingInput({}, {
      confidence: {
        level: 'high' as const,
        value: 0.9,
        justification: 'Strong static signal',
        factors
      }
    });
    const created = engine.createFinding(input);
    expect(created.confidence.factors).toHaveLength(2);
    expect(created.confidence.level).toBe('high');
  });

  it('round-trips provenance and reproducibility', () => {
    const ctx = createSessionAndTarget();
    const input = baseFindingInput(ctx, {
      provenance: {
        derivedFrom: [],
        tool: 'rizin',
        command: 'rizin -qc iz sample.exe',
        parameters: { format: 'json' },
        duration: 250,
        toolVersion: '0.7.4'
      },
      reproducibility: {
        reproducible: true,
        environmentId: ctx.envId,
        steps: [
          { order: 1, action: 'install rizin', tool: 'package-manager', parameters: {}, expectedOutcome: 'rizin on PATH' }
        ],
        knownVariations: [
          { condition: 'stripped binary', effectOnFinding: 'minor' as const }
        ]
      }
    });
    const created = engine.createFinding(input);
    expect(created.provenance.command).toBe('rizin -qc iz sample.exe');
    expect(created.provenance.duration).toBe(250);
    expect(created.reproducibility.steps).toHaveLength(1);
    expect(created.reproducibility.knownVariations).toHaveLength(1);
  });

  it('createFindings persists multiple findings', () => {
    const inputs = [baseFindingInput(), baseFindingInput(), baseFindingInput()];
    const created = engine.createFindings(inputs);
    expect(created).toHaveLength(3);
    created.forEach(f => expect(f.id).toMatch(/^fnd_[0-9a-f]{16}$/));
  });
});

describe('EvidenceEngine — queryFindings', () => {
  let engine: EvidenceEngine;
  let sessionId: string;

  beforeAll(() => {
    engine = makeEvidenceEngine();
    const ctx = createSessionAndTarget();
    sessionId = ctx.sessionId;

    engine.createFinding(baseFindingInput(ctx, { category: 'structure', severity: 'low', title: 'low structure' }));
    engine.createFinding(baseFindingInput(ctx, { category: 'code', severity: 'high', title: 'high code' }));
    engine.createFinding(baseFindingInput(ctx, { category: 'structure', severity: 'medium', title: 'medium structure' }));
  });

  it('returns all findings for a session', () => {
    const result = engine.queryFindings({ sessionId });
    expect(result.total).toBe(3);
    expect(result.findings).toHaveLength(3);
    expect(result.hasMore).toBe(false);
  });

  it('filters by category', () => {
    const result = engine.queryFindings({ sessionId, category: 'structure' });
    expect(result.total).toBe(2);
    expect(result.findings.every(f => f.category === 'structure')).toBe(true);
  });

  it('filters by severity', () => {
    const result = engine.queryFindings({ sessionId, severity: 'high' });
    expect(result.total).toBe(1);
    expect(result.findings[0].title).toBe('high code');
  });

  it('filters by confidence minimum', () => {
    // Findings are created with default confidence value 0.5, so 0.4 should match all 3.
    const result = engine.queryFindings({ sessionId, confidenceMin: 0.4 });
    expect(result.total).toBe(3);
    expect(result.findings.every(f => f.confidence.value >= 0.4)).toBe(true);
  });

  it('paginates results', () => {
    const page1 = engine.queryFindings({ sessionId, limit: 2, offset: 0 });
    expect(page1.findings).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page2 = engine.queryFindings({ sessionId, limit: 2, offset: 2 });
    expect(page2.findings).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });
});

describe('EvidenceEngine — getSessionStatistics', () => {
  let engine: EvidenceEngine;
  let sessionId: string;

  beforeAll(() => {
    engine = makeEvidenceEngine();
    const ctx = createSessionAndTarget();
    sessionId = ctx.sessionId;

    engine.createFinding(baseFindingInput(ctx, { category: 'structure', severity: 'low' }));
    engine.createFinding(baseFindingInput(ctx, { category: 'code', severity: 'high' }));
  });

  it('computes statistics', () => {
    const stats = engine.getSessionStatistics(sessionId);
    expect(stats.findingsByCategory).toMatchObject({ structure: 1, code: 1 });
    expect(stats.findingsBySeverity).toMatchObject({ low: 1, high: 1 });
    expect(stats.avgConfidence).toBeGreaterThanOrEqual(0);
    expect(stats.avgConfidence).toBeLessThanOrEqual(1);
  });
});

describe('EvidenceEngine — calculateConfidence', () => {
  let engine: EvidenceEngine;

  beforeAll(() => {
    engine = makeEvidenceEngine();
  });

  it('returns base confidence with no factors', () => {
    const score = engine.calculateConfidence([]);
    expect(score.value).toBe(0.5);
    expect(score.level).toBe('medium');
  });

  it('applies positive factors', () => {
    const factors: ConfidenceFactor[] = [
      { name: 'f1', impact: 'positive', description: 'd1', weight: 1.0 }
    ];
    const score = engine.calculateConfidence(factors);
    expect(score.value).toBeGreaterThan(0.5);
  });

  it('applies negative factors', () => {
    const factors: ConfidenceFactor[] = [
      { name: 'f1', impact: 'negative', description: 'd1', weight: 1.0 }
    ];
    const score = engine.calculateConfidence(factors);
    expect(score.value).toBeLessThan(0.5);
  });

  it('clamps to [0, 1]', () => {
    const factors: ConfidenceFactor[] = [
      { name: 'f1', impact: 'positive', description: 'd1', weight: 10.0 }
    ];
    const score = engine.calculateConfidence(factors);
    expect(score.value).toBeLessThanOrEqual(1);
    expect(score.value).toBeGreaterThanOrEqual(0);

    const factors2: ConfidenceFactor[] = [
      { name: 'f1', impact: 'negative', description: 'd1', weight: 10.0 }
    ];
    const score2 = engine.calculateConfidence(factors2);
    expect(score2.value).toBeGreaterThanOrEqual(0);
    expect(score2.level).toBe('none');
  });

  it('classifies confidence levels correctly', () => {
    const high: ConfidenceFactor[] = [{ name: 'f', impact: 'positive', description: 'd', weight: 5.0 }];
    expect(engine.calculateConfidence(high).level).toBe('high');

    const mid: ConfidenceFactor[] = [];
    expect(engine.calculateConfidence(mid).level).toBe('medium');

    const low: ConfidenceFactor[] = [{ name: 'f', impact: 'negative', description: 'd', weight: 1.0 }];
    expect(engine.calculateConfidence(low).level).toBe('low');
  });
});

describe('EvidenceEngine — validation: invalid evidence (negative tests)', () => {
  let engine: EvidenceEngine;

  beforeAll(() => {
    engine = makeEvidenceEngine();
  });

  it('rejects finding with unknown session', () => {
    const input = baseFindingInput({ sessionId: 'ses_ffffffffffffffff' });
    expect(() => engine.createFinding(input)).toThrow(NotFoundError);
  });

  it('rejects finding with unknown target', () => {
    const input = baseFindingInput({ targetId: 'tgt_ffffffffffffffff' });
    expect(() => engine.createFinding(input)).toThrow(NotFoundError);
  });

  it('rejects confidence value below 0', () => {
    const input = baseFindingInput({}, {
      confidence: { level: 'none' as const, value: -0.1, justification: 'bad', factors: [] }
    });
    expect(() => engine.createFinding(input)).toThrow(ValidationError);
  });

  it('rejects confidence value above 1', () => {
    const input = baseFindingInput({}, {
      confidence: { level: 'high' as const, value: 1.5, justification: 'bad', factors: [] }
    });
    expect(() => engine.createFinding(input)).toThrow(ValidationError);
  });

  it('rejects missing confidence justification', () => {
    const input = baseFindingInput({}, {
      confidence: { level: 'medium' as const, value: 0.5, justification: '', factors: [] }
    });
    expect(() => engine.createFinding(input)).toThrow(ValidationError);
  });

  it('rejects evidence reference without type', () => {
    const input = baseFindingInput({}, {
      evidence: [
        {
          id: 'ev_bad',
          type: undefined as unknown as string,
          location: {},
          timestamp: new Date().toISOString()
        }
      ]
    });
    expect(() => engine.createFinding(input)).toThrow(ValidationError);
  });

  it('rejects evidence reference without location', () => {
    const input = baseFindingInput({}, {
      evidence: [
        {
          id: 'ev_bad2',
          type: 'tool-output' as const,
          location: undefined as unknown as Record<string, unknown>,
          timestamp: new Date().toISOString()
        }
      ]
    });
    expect(() => engine.createFinding(input)).toThrow(ValidationError);
  });

  it('getFinding returns null for unknown finding', () => {
    expect(engine.getFinding('fnd_ffffffffffffffff')).toBeNull();
  });

  it('getFindingOrThrow throws for unknown finding', () => {
    expect(() => engine.getFindingOrThrow('fnd_ffffffffffffffff')).toThrow(NotFoundError);
  });

  it('queryFindings throws for unknown session', () => {
    expect(() => engine.queryFindings({ sessionId: 'ses_ffffffffffffffff' })).toThrow(NotFoundError);
  });
});

describe('EvidenceEngine — createEvidenceReference, createProvenance, createReproducibility', () => {
  let engine: EvidenceEngine;

  beforeAll(() => {
    engine = makeEvidenceEngine();
  });

  it('builds an evidence reference with hash', () => {
    const ref = engine.createEvidenceReference({
      type: 'file',
      location: { file: 'sample.exe', offset: 0 },
      excerpt: 'hello world',
      tool: 'test-tool'
    });

    expect(ref.id).toMatch(/^fnd_[0-9a-f]{16}$/);
    expect(ref.type).toBe('file');
    expect(ref.hash).toBeDefined();
    expect(ref.timestamp).toBeDefined();
    expect(ref.tool).toBe('test-tool');
  });

  it('truncates long excerpts', () => {
    const longExcerpt = 'x'.repeat(2000);
    const ref = engine.createEvidenceReference({
      type: 'observation',
      location: {},
      excerpt: longExcerpt
    });
    expect(ref.excerpt.length).toBeLessThanOrEqual(1000);
  });

  it('builds provenance', () => {
    const prov = engine.createProvenance({
      derivedFrom: ['fnd_0000000000000001'],
      tool: 'rizin',
      command: 'rizin -qc iz',
      parameters: { deep: true },
      duration: 100,
      toolVersion: '0.7.4'
    });
    expect(prov.tool).toBe('rizin');
    expect(prov.duration).toBe(100);
    expect(prov.derivedFrom).toEqual(['fnd_0000000000000001']);
  });

  it('builds reproducibility with defaults', () => {
    const repro = engine.createReproducibility({
      reproducible: false,
      environmentId: 'env_123',
      steps: []
    });
    expect(repro.reproducible).toBe(false);
    expect(repro.environmentId).toBe('env_123');
    expect(repro.knownVariations).toEqual([]);
  });
});
