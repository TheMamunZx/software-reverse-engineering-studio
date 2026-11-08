import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Repository } from '../src/storage/repository.js';
import { SessionManager } from '../src/engine/session-manager.js';
import { EvidenceEngine } from '../src/evidence/evidence-engine.js';
import type { AuthorizationRecord, InvestigationSession, SessionConfig, SessionProgress } from '../src/types/investigation.js';
import type { AnalysisTarget } from '../src/types/target.js';

interface TempDbHandle {
  directory: string;
  repository: Repository;
}

let handle: TempDbHandle;
const extraRepos: Array<{ close(): void; cleanup(): void }> = [];

function createTempRepository(label: string): TempDbHandle {
  const directory = mkdtempSync(path.join(tmpdir(), `sre-studio-session-${label}-`));
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
  description: 'Session manager test authorization',
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

function makeSessionManager(): SessionManager {
  return new SessionManager({
    repository: handle.repository,
    evidenceEngine: new EvidenceEngine({ repository: handle.repository })
  });
}

function baseSessionInput(overrides: Partial<InvestigationSession> = {}) {
  return {
    projectId: 'proj_sm',
    name: 'Session manager test',
    targets: [] as InvestigationSession['targets'],
    authorization,
    status: 'initialized' as const,
    progress: defaultProgress,
    config: sessionConfig,
    createdBy: 'sm-test',
    ...overrides
  };
}

describe('SessionManager — createSession', () => {
  let sessionManager: SessionManager;

  beforeAll(() => {
    sessionManager = makeSessionManager();
  });

  it('creates a session with generated ID and timestamps', async () => {
    const session = await sessionManager.createSession(baseSessionInput());

    expect(session.id).toMatch(/^ses_[0-9a-f]{16}$/);
    expect(session.createdAt).toBe(session.updatedAt);
    expect(session.name).toBe('Session manager test');
    expect(session.status).toBe('initialized');
    expect(session.projectId).toBe('proj_sm');
    expect(session.createdBy).toBe('sm-test');
    expect(session.tags).toEqual([]);
  });

  it('creates a session with initial target', async () => {
    const session = await sessionManager.createSession({
      ...baseSessionInput(),
      initialTarget: {
        type: 'binary',
        path: 'C:/targets/sample.exe',
        metadata: {},
        hashes: { sha256: 'x'.repeat(64) },
        authorization,
        role: 'primary'
      }
    });

    expect(session.targets).toHaveLength(1);
    expect(session.targets[0].role).toBe('primary');

    const target = sessionManager.getTarget(session.targets[0].targetId);
    expect(target).not.toBeNull();
    expect(target?.path).toBe('C:/targets/sample.exe');
  });

  it('persists session to SQLite and reads it back', async () => {
    const created = await sessionManager.createSession(baseSessionInput({ name: 'persist-me' }));

    const loaded = sessionManager.getSession(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.name).toBe('persist-me');
  });

  it('returns null for unknown session', () => {
    expect(sessionManager.getSession('ses_ffffffffffffffff')).toBeNull();
  });

  it('getSessionOrThrow throws for unknown session', () => {
    expect(() => sessionManager.getSessionOrThrow('ses_ffffffffffffffff')).toThrow();
  });
});

describe('SessionManager — update and lifecycle', () => {
  let sessionManager: SessionManager;
  let sessionId: string;

  beforeAll(async () => {
    sessionManager = makeSessionManager();
    const session = await sessionManager.createSession(baseSessionInput({ name: 'lifecycle' }));
    sessionId = session.id;
  });

  it('updates session status', () => {
    const updated = sessionManager.updateSessionStatus(sessionId, 'running');
    expect(updated?.status).toBe('running');

    const loaded = sessionManager.getSession(sessionId);
    expect(loaded?.status).toBe('running');
  });

  it('updates progress', () => {
    const updated = sessionManager.updateProgress(sessionId, {
      completedSteps: 3,
      findingsCount: 5
    });
    expect(updated?.progress.completedSteps).toBe(3);
    expect(updated?.progress.findingsCount).toBe(5);
  });

  it('closes session with completed status', () => {
    const closed = sessionManager.closeSession(sessionId, 'completed');
    expect(closed?.status).toBe('completed');
  });

  it('closes session with cancelled status (archived)', async () => {
    const session = await sessionManager.createSession(baseSessionInput({ name: 'cancel' }));
    const closed = sessionManager.closeSession(session.id, 'cancelled');
    expect(closed?.status).toBe('archived');
  });

  it('closes session with error status (failed)', async () => {
    const session = await sessionManager.createSession(baseSessionInput({ name: 'error' }));
    const closed = sessionManager.closeSession(session.id, 'error');
    expect(closed?.status).toBe('failed');
  });
});

describe('SessionManager — listSessions', () => {
  let sessionManager: SessionManager;

  beforeAll(() => {
    sessionManager = makeSessionManager();
  });

  it('lists sessions newest-first', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sre-studio-list-'));
    const isolated = new Repository({ dbPath: path.join(directory, 'investigation.db') });
    extraRepos.push({
      close: () => isolated.close(),
      cleanup: () => rmSync(directory, { recursive: true, force: true })
    });
    const isolatedManager = new SessionManager({ repository: isolated, evidenceEngine: new EvidenceEngine({ repository: isolated }) });

    const t1 = new Date('2026-02-01T00:00:00.000Z').toISOString();
    const t2 = new Date('2026-02-02T00:00:00.000Z').toISOString();

    await isolatedManager.createSession(baseSessionInput({ name: 'first', createdAt: t1, updatedAt: t1 }));
    await isolatedManager.createSession(baseSessionInput({ name: 'second', createdAt: t2, updatedAt: t2 }));

    const sessions = isolatedManager.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions.map(s => s.name)).toEqual(['second', 'first']);
  });

  it('filters sessions by projectId', async () => {
    await sessionManager.createSession(baseSessionInput({ name: 'proj-a-1', projectId: 'proj-a' }));
    await sessionManager.createSession(baseSessionInput({ name: 'proj-a-2', projectId: 'proj-a' }));
    await sessionManager.createSession(baseSessionInput({ name: 'proj-b-1', projectId: 'proj-b' }));

    const projA = sessionManager.listSessions('proj-a');
    expect(projA.length).toBe(2);
    expect(projA.every(s => s.projectId === 'proj-a')).toBe(true);

    const projB = sessionManager.listSessions('proj-b');
    expect(projB.length).toBe(1);
  });
});

describe('SessionManager — target operations', () => {
  let sessionManager: SessionManager;
  let sessionId: string;

  beforeAll(async () => {
    sessionManager = makeSessionManager();
    const session = await sessionManager.createSession(baseSessionInput({ name: 'target-ops' }));
    sessionId = session.id;
  });

  it('registers a target to a session', () => {
    const target = sessionManager.registerTarget(sessionId, {
      type: 'android',
      path: 'C:/targets/app.apk',
      metadata: {},
      hashes: { sha256: 'y'.repeat(64) },
      authorization,
      role: 'secondary'
    });

    expect(target.id).toMatch(/^tgt_[0-9a-f]{16}$/);
    expect(target.sessionId).toBe(sessionId);
    expect(target.type).toBe('android');
    expect(target.role).toBe('secondary');
  });

  it('getTargets returns targets for a session', () => {
    const targets = sessionManager.getTargets(sessionId);
    expect(targets.length).toBeGreaterThanOrEqual(1);
  });

  it('getTarget returns a specific target', () => {
    const target = sessionManager.registerTarget(sessionId, {
      type: 'binary',
      path: 'C:/targets/another.exe',
      metadata: {},
      hashes: { sha256: 'z'.repeat(64) },
      authorization,
      role: 'primary'
    });

    const found = sessionManager.getTarget(target.id);
    expect(found).not.toBeNull();
    expect(found?.path).toBe('C:/targets/another.exe');
  });

  it('returns null for unknown target', () => {
    expect(sessionManager.getTarget('tgt_ffffffffffffffff')).toBeNull();
  });

  it('registerTarget throws for unknown session', () => {
    expect(() => sessionManager.registerTarget('ses_ffffffffffffffff', {
      type: 'binary',
      path: 'C:/targets/x.exe',
      metadata: {},
      hashes: { sha256: 'w'.repeat(64) },
      authorization,
      role: 'primary'
    })).toThrow();
  });
});
