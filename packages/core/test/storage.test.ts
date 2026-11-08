import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Repository } from '../src/storage/repository.js';
import { migrations } from '../src/storage/migrations/migrator.js';
import type {
  AuthorizationRecord,
  InvestigationSession,
  SessionConfig,
  SessionProgress
} from '../src/types/investigation.js';
import type { Finding } from '../src/types/evidence.js';

interface TempDbHandle {
  directory: string;
  dbPath: string;
  repository: Repository;
}

let repo: TempDbHandle;
const extraRepos: Array<{ close(): void; cleanup(): void }> = [];

function createTempRepository(label: string): TempDbHandle {
  const directory = mkdtempSync(path.join(tmpdir(), `sre-studio-storage-${label}-`));
  const dbPath = path.join(directory, 'investigation.db');
  const repository = new Repository({ dbPath });
  const handle: TempDbHandle = { directory, dbPath, repository };
  return handle;
}

beforeAll(() => {
  repo = createTempRepository('main');
});

afterAll(() => {
  repo.repository.close();
  rmSync(repo.directory, { recursive: true, force: true });
  for (const entry of extraRepos) {
    entry.close();
    entry.cleanup();
  }
});

const authorization: AuthorizationRecord = {
  type: 'owner',
  description: 'Local synthetic binary used for unit testing only',
  scope: ['C:/targets/sample.exe'],
  limitations: ['test fixture'],
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

function baseSessionInput(overrides: Partial<InvestigationSession> = {}) {
  return {
    projectId: 'proj_test',
    name: 'Storage unit test',
    description: 'Synthetic session created by the storage test suite',
    targets: [] as InvestigationSession['targets'],
    authorization,
    status: 'initialized' as const,
    progress: defaultProgress,
    config: sessionConfig,
    createdBy: 'storage-test',
    tags: ['unit-test'],
    ...overrides
  };
}

describe('SQLite migrations', () => {
  it('records migration 1 and migration 2', () => {
    const rows = repo.repository.getAdapter().prepare('SELECT version, description FROM schema_version ORDER BY version').all() as Array<{ version: number; description: string }>;
    expect(rows).toHaveLength(migrations.length);
    expect(rows[0].version).toBe(1);
    expect(rows[0].description).toBe(migrations[0].description);
    expect(rows[1].version).toBe(2);
    expect(rows[1].description).toBe(migrations[1].description);
  });

  it('creates all five core tables plus audit_logs', () => {
    const tables = repo.repository.getAdapter().prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    for (const expected of ['schema_version', 'sessions', 'targets', 'environments', 'findings', 'audit_logs']) {
      expect(names).toContain(expected);
    }
  });

  it('foreign keys are enforced', () => {
    // Attempting to insert a finding for a non-existent target should fail.
    expect(() => {
      repo.repository.getAdapter().prepare(
        'INSERT INTO findings (id, session_id, target_id, provider_id, capability_id, category, severity, title, observation, evidence_json, confidence_level, confidence_value, confidence_justification, limitations_json, unknowns_json, provenance_json, reproducibility_json, created_at, updated_at, created_by, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'fnd_invalid_fk',
        'ses_nonexistent',
        'tgt_nonexistent',
        'provider',
        'binary.info',
        'structure',
        'info',
        'title',
        'observation',
        '[]',
        'high',
        0.9,
        'justification',
        '[]',
        '[]',
        '{}',
        '{}',
        new Date().toISOString(),
        new Date().toISOString(),
        'test',
        1
      );
    }).toThrow();
  });

  it('fresh databases converge on the latest schema version', () => {
    const second = createTempRepository('second');
    extraRepos.push({
      close: () => second.repository.close(),
      cleanup: () => rmSync(second.directory, { recursive: true, force: true })
    });
    const rows = second.repository.getAdapter().prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number };
    expect(rows.version).toBe(migrations.length);
  });
});

describe('session persistence', () => {
  it('creates and reads back a session', () => {
    const created = repo.repository.createSession(baseSessionInput());
    expect(created.id).toMatch(/^ses_[0-9a-f]{16}$/);
    expect(created.createdAt).toBe(created.updatedAt);

    const loaded = repo.repository.getSession(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Storage unit test');
    expect(loaded?.status).toBe('initialized');
    expect(loaded?.projectId).toBe('proj_test');
    expect(loaded?.authorization.type).toBe('owner');
    expect(loaded?.tags).toEqual(['unit-test']);
    expect(loaded?.createdBy).toBe('storage-test');
  });

  it('lists sessions newest-first with deterministic ordering', () => {
    const isolated = createTempRepository('listing');
    extraRepos.push({
      close: () => isolated.repository.close(),
      cleanup: () => rmSync(isolated.directory, { recursive: true, force: true })
    });

    // Use explicitly different timestamps so ordering is deterministic.
    const t1 = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const t2 = new Date('2026-01-02T00:00:00.000Z').toISOString();

    const first = isolated.repository.createSession(baseSessionInput({ name: 'first', createdAt: t1, updatedAt: t1 }));
    const second = isolated.repository.createSession(baseSessionInput({ name: 'second', createdAt: t2, updatedAt: t2 }));

    const sessions = isolated.repository.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions.map(s => s.name)).toEqual(['second', 'first']);
    expect(sessions.map(s => s.id).includes(first.id)).toBe(true);
  });

  it('updates and deletes sessions', () => {
    const created = repo.repository.createSession(baseSessionInput({ name: 'to-update' }));

    const updated = repo.repository.updateSession(created.id, { status: 'paused' });
    expect(updated?.status).toBe('paused');
    expect(updated?.name).toBe('to-update');

    expect(repo.repository.deleteSession(created.id)).toBe(true);
    expect(repo.repository.getSession(created.id)).toBeNull();
    expect(repo.repository.deleteSession(created.id)).toBe(false);
  });

  it('returns null for unknown sessions', () => {
    expect(repo.repository.getSession('ses_ffffffffffffffff')).toBeNull();
  });

  it('getSessionOrThrow throws NotFoundError for unknown sessions', () => {
    expect(() => repo.repository.getSessionOrThrow('ses_ffffffffffffffff')).toThrow();
  });
});

describe('target persistence', () => {
  it('registers a target and reads it back with its session linkage', () => {
    const session = repo.repository.createSession(baseSessionInput({ name: 'targets session' }));
    const target = repo.repository.registerTarget(session.id, {
      type: 'binary',
      path: repo.directory.replace(/\\/g, '/') + '/sample.exe',
      metadata: {},
      hashes: { sha256: 'a'.repeat(64) },
      authorization,
      role: 'primary'
    });

    expect(target.id).toMatch(/^tgt_[0-9a-f]{16}$/);
    expect(target.sessionId).toBe(session.id);
    expect(target.role).toBe('primary');

    const targets = repo.repository.getTargetsBySession(session.id);
    expect(targets.length).toBe(1);
    expect(targets[0].path).toContain('sample.exe');
    expect(targets[0].hashes).toEqual({ sha256: 'a'.repeat(64) });
  });

  it('getTargetOrThrow throws NotFoundError for unknown target', () => {
    expect(() => repo.repository.getTargetOrThrow('tgt_ffffffffffffffff')).toThrow();
  });

  it('returns null for unknown targets via getTarget', () => {
    expect(repo.repository.getTarget('tgt_ffffffffffffffff')).toBeNull();
  });
});

describe('finding persistence', () => {
  let sessionId: string;
  let targetId: string;
  let fixtureEnvironmentId: string;
  const now = () => new Date().toISOString();

  beforeAll(() => {
    const session = repo.repository.createSession(baseSessionInput({ name: 'findings session' }));
    sessionId = session.id;
    const target = repo.repository.registerTarget(sessionId, {
      type: 'binary',
      path: repo.directory.replace(/\\/g, '/') + '/findings.exe',
      metadata: {},
      hashes: { sha256: 'b'.repeat(64) },
      authorization,
      role: 'primary'
    });
    targetId = target.id;
    const environment = repo.repository.createEnvironment({
      sessionId,
      os: process.platform,
      arch: process.arch,
      tools: [],
      providerVersions: {},
      targetHash: 'c'.repeat(64)
    });
    fixtureEnvironmentId = environment.id;
  });

  function findingInput(overrides: Partial<Omit<Finding, 'id' | 'createdAt' | 'updatedAt' | 'version'>> = {}) {
    const timestamp = now();
    return {
      sessionId,
      targetId,
      providerId: 'binary-provider',
      capabilityId: 'binary.strings',
      category: 'structure' as const,
      severity: 'low' as const,
      title: 'Test finding',
      observation: 'Strings table contains a test marker',
      inference: 'Fixture is synthetic',
      evidence: [
        {
          id: 'ev_0001',
          type: 'tool-output' as const,
          location: { offset: 0, length: 2 },
          excerpt: 'MZ',
          timestamp,
          tool: 'rizin'
        }
      ],
      confidence: {
        level: 'medium' as const,
        value: 0.55,
        justification: 'Static strings only',
        factors: []
      },
      limitations: ['strings only'],
      unknowns: ['semantic role'],
      provenance: {
        derivedFrom: [],
        tool: 'rizin',
        command: 'rizin -qc izz sample.exe',
        parameters: {},
        duration: 5,
        toolVersion: '0.7.4'
      },
      reproducibility: {
        reproducible: true,
        environmentId: fixtureEnvironmentId,
        steps: [],
        knownVariations: []
      },
      tags: [],
      createdBy: 'storage-test',
      ...overrides
    };
  }

  it('round-trips a finding with confidence and provenance', () => {
    const created = repo.repository.createFinding(findingInput());
    expect(created.id).toMatch(/^fnd_[0-9a-f]{16}$/);
    expect(created.version).toBe(1);

    const loaded = repo.repository.getFinding(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe('Test finding');
    expect(loaded?.confidence.level).toBe('medium');
    expect(loaded?.confidence.value).toBeCloseTo(0.55);
    expect(loaded?.evidence).toHaveLength(1);
    expect(loaded?.evidence[0].tool).toBe('rizin');
    expect(loaded?.provenance.tool).toBe('rizin');
    expect(loaded?.reproducibility.reproducible).toBe(true);
    expect(loaded?.limitations).toEqual(['strings only']);
  });

  it('getFindingOrThrow throws NotFoundError for unknown finding', () => {
    expect(() => repo.repository.getFindingOrThrow('fnd_ffffffffffffffff')).toThrow();
  });

  it('filters findings by severity and category', () => {
    repo.repository.createFinding(findingInput({ severity: 'high', title: 'high severity marker' }));
    repo.repository.createFinding(findingInput({ category: 'behavior', title: 'behavior marker' }));

    const high = repo.repository.queryFindings({ sessionId, severity: 'high' });
    expect(high.total).toBe(1);
    expect(high.findings[0].title).toBe('high severity marker');

    const behavior = repo.repository.queryFindings({ sessionId, category: 'behavior' });
    expect(behavior.total).toBe(1);
    expect(behavior.findings[0].title).toBe('behavior marker');

    const all = repo.repository.queryFindings({ sessionId });
    expect(all.total).toBe(3);
  });

  it('filters findings by confidence minimum', () => {
    repo.repository.createFinding(findingInput({ confidence: { level: 'high', value: 0.9, justification: 'high', factors: [] } }));
    repo.repository.createFinding(findingInput({ confidence: { level: 'low', value: 0.2, justification: 'low', factors: [] } }));

    const highConf = repo.repository.queryFindings({ sessionId, confidenceMin: 0.8 });
    expect(highConf.total).toBe(1);

    const allConf = repo.repository.queryFindings({ sessionId, confidenceMin: 0.0 });
    expect(allConf.total).toBe(5);
  });

  it('computes session statistics', () => {
    // Use an isolated session so statistics are deterministic regardless of test order.
    const isolated = createTempRepository('stats');
    extraRepos.push({
      close: () => isolated.repository.close(),
      cleanup: () => rmSync(isolated.directory, { recursive: true, force: true })
    });
    const session = isolated.repository.createSession(baseSessionInput({ name: 'stats session' }));
    const target = isolated.repository.registerTarget(session.id, {
      type: 'binary',
      path: isolated.directory.replace(/\\/g, '/') + '/stats.exe',
      metadata: {},
      hashes: { sha256: 'd'.repeat(64) },
      authorization,
      role: 'primary'
    });
    const env = isolated.repository.createEnvironment({
      sessionId: session.id,
      os: process.platform,
      arch: process.arch,
      tools: [],
      providerVersions: {},
      targetHash: 'e'.repeat(64)
    });

    isolated.repository.createFinding({
      sessionId: session.id,
      targetId: target.id,
      providerId: 'p',
      capabilityId: 'c',
      category: 'structure',
      severity: 'low',
      title: 's1',
      observation: 'o',
      evidence: [],
      confidence: { level: 'medium', value: 0.5, justification: 'j', factors: [] },
      limitations: [],
      unknowns: [],
      provenance: { derivedFrom: [], tool: 't', command: 'c', parameters: {}, duration: 1, toolVersion: 'v' },
      reproducibility: { reproducible: true, environmentId: env.id, steps: [], knownVariations: [] },
      tags: [],
      createdBy: 'test'
    });
    isolated.repository.createFinding({
      sessionId: session.id,
      targetId: target.id,
      providerId: 'p',
      capabilityId: 'c',
      category: 'behavior',
      severity: 'high',
      title: 's2',
      observation: 'o',
      evidence: [],
      confidence: { level: 'high', value: 0.9, justification: 'j', factors: [] },
      limitations: [],
      unknowns: [],
      provenance: { derivedFrom: [], tool: 't', command: 'c', parameters: {}, duration: 1, toolVersion: 'v' },
      reproducibility: { reproducible: true, environmentId: env.id, steps: [], knownVariations: [] },
      tags: [],
      createdBy: 'test'
    });

    const stats = isolated.repository.getSessionStatistics(session.id);
    expect(stats.findingsByCategory).toMatchObject({ structure: 1, behavior: 1 });
    expect(stats.findingsBySeverity).toMatchObject({ low: 1, high: 1 });
    expect(stats.avgConfidence).toBeCloseTo(0.7);
  });

  it('queryFindings throws NotFoundError for unknown session', () => {
    expect(() => repo.repository.queryFindings({ sessionId: 'ses_ffffffffffffffff' })).toThrow();
  });

  it('audit log write and query round-trips', () => {
    const nowIso = new Date().toISOString();
    repo.repository.writeAuditLog({
      sessionId,
      targetId,
      capabilityId: 'binary.strings',
      operation: 'analysis',
      decision: 'allow',
      reason: undefined,
      approvalNeeded: [],
      timestamp: nowIso,
      details: { tool: 'rizin' }
    });

    repo.repository.writeAuditLog({
      sessionId,
      targetId,
      capabilityId: 'android.manifest',
      operation: 'analysis',
      decision: 'deny',
      reason: 'target-denied',
      approvalNeeded: [],
      timestamp: nowIso,
      details: {}
    });

    const logs = repo.repository.queryAuditLogs({ sessionId });
    expect(logs.total).toBe(2);
    expect(logs.logs[0].decision).toBe('deny'); // newest first
    expect(logs.logs[1].decision).toBe('allow');

    const denied = repo.repository.queryAuditLogs({ sessionId, decision: 'deny' });
    expect(denied.total).toBe(1);
  });
});
