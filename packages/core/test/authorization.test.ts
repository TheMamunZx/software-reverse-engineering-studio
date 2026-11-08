import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Repository } from '../src/storage/repository.js';
import { createAuthorizationManager, defaultBoundaries } from '../src/security/authorization.js';
import { SessionManager } from '../src/engine/session-manager.js';
import { EvidenceEngine } from '../src/evidence/evidence-engine.js';
import { AuthorizationError } from '@sre-studio/shared';
import type { AuthorizationRecord, InvestigationSession, SessionConfig, SessionProgress } from '../src/types/investigation.js';
import type { AnalysisTarget } from '../src/types/target.js';
import type { AuthorizationBoundary } from '../src/security/boundaries.js';

interface TempDbHandle {
  directory: string;
  repository: Repository;
}

let handle: TempDbHandle;
const extraRepos: Array<{ close(): void; cleanup(): void }> = [];

function createTempRepository(label: string): TempDbHandle {
  const directory = mkdtempSync(path.join(tmpdir(), `sre-studio-auth-${label}-`));
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
  description: 'Test authorization',
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

function createSessionWithTarget(overrides: Partial<InvestigationSession> = {}): InvestigationSession {
  return handle.repository.createSession({
    projectId: 'proj_auth',
    name: 'Auth test session',
    targets: [],
    authorization,
    status: 'initialized',
    progress: defaultProgress,
    config: sessionConfig,
    createdBy: 'auth-test',
    ...overrides
  });
}

function registerBinaryTarget(sessionId: string, path: string = 'C:/targets/sample.exe'): AnalysisTarget {
  return handle.repository.registerTarget(sessionId, {
    type: 'binary',
    path,
    metadata: {},
    hashes: { sha256: 'a'.repeat(64) },
    authorization,
    role: 'primary'
  });
}

function createAuthManager(boundaries: AuthorizationBoundary, sessionManager: SessionManager) {
  return createAuthorizationManager(boundaries, sessionManager, handle.repository);
}

describe('AuthorizationManager — default boundaries (fail-closed)', () => {
  let sessionManager: SessionManager;
  let authManager: ReturnType<typeof createAuthManager>;

  beforeAll(() => {
    sessionManager = new SessionManager({ repository: handle.repository, evidenceEngine: new EvidenceEngine({ repository: handle.repository }) });
    authManager = createAuthManager(defaultBoundaries, sessionManager);
  });

  it('denies all targets when allowedTargets is empty (fail-closed)', async () => {
    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    await expect(authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    })).rejects.toThrow(AuthorizationError);

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny' && l.reason === 'target-denied')).toBe(true);
  });

  it('denies all capabilities when allowedCapabilities is empty (fail-closed)', async () => {
    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    // Even with an explicit target allow, no capabilities are allowed by default.
    const boundaries = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary' }]
    };
    const strictAuth = createAuthManager(boundaries, sessionManager);

    await expect(strictAuth.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    })).rejects.toThrow(AuthorizationError);

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny' && l.reason === 'capability-denied')).toBe(true);
  });

  it('wildcard type "*" is not enabled by default', () => {
    expect(defaultBoundaries.allowedTargets).toHaveLength(0);
    expect(defaultBoundaries.allowedCapabilities).toHaveLength(0);
  });

  it('audit log records deny decisions for default boundaries', async () => {
    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    try {
      await authManager.authorize({
        sessionId: session.id,
        targetId: target.id,
        capabilityId: 'binary.info',
        operation: 'analysis'
      });
    } catch {
      // Expected to throw
    }

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.total).toBeGreaterThanOrEqual(1);
    expect(logs.logs.some(l => l.decision === 'deny')).toBe(true);
  });
});

describe('AuthorizationManager — explicit authorization grants (authorized testing)', () => {
  let sessionManager: SessionManager;

  beforeAll(() => {
    sessionManager = new SessionManager({ repository: handle.repository, evidenceEngine: new EvidenceEngine({ repository: handle.repository }) });
  });

  it('allows target explicitly granted via allowedTargets (with matching capability)', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary', pathPattern: 'C:/authorized/.*' }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id, 'C:/authorized/sample.exe');

    const result = await authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('allows capability explicitly granted via allowedCapabilities', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary' }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    const result = await authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('denies target not matching explicit grant (target mismatch)', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary', pathPattern: 'C:/allowed/.*' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id, 'C:/forbidden/sample.exe');

    await expect(authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    })).rejects.toThrow(AuthorizationError);

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny' && l.reason === 'target-denied')).toBe(true);
  });

  it('denies capability not matching explicit grant (capability denial)', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary' }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    await expect(authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'android.manifest',
      operation: 'analysis'
    })).rejects.toThrow(AuthorizationError);

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny' && l.reason === 'capability-denied')).toBe(true);
  });

  it('denies when no explicit authorization record exists for target', async () => {
    // defaultBoundaries is fail-closed: empty allowedTargets means deny all
    const authManager = createAuthManager(defaultBoundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    await expect(authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    })).rejects.toThrow(AuthorizationError);

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny' && l.reason === 'target-denied')).toBe(true);
  });
});

describe('AuthorizationManager — restricted target boundaries', () => {
  let sessionManager: SessionManager;

  beforeAll(() => {
    sessionManager = new SessionManager({ repository: handle.repository, evidenceEngine: new EvidenceEngine({ repository: handle.repository }) });
  });

  it('denies target not matching allowed type', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'android' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id, 'C:/targets/sample.exe');

    await expect(authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    })).rejects.toThrow();

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny' && l.reason === 'target-denied')).toBe(true);
  });

  it('denies target not matching path pattern', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary', pathPattern: 'C:/allowed/.*' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id, 'C:/forbidden/sample.exe');

    await expect(authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    })).rejects.toThrow();

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny')).toBe(true);
  });

  it('allows target matching path pattern (with matching capability)', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary', pathPattern: 'C:/allowed/.*' }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id, 'C:/allowed/sample.exe');

    const result = await authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    });

    expect(result.allowed).toBe(true);
  });

  it('denies target not in hash allowlist', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary', hashAllowlist: ['0'.repeat(64)] }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id, 'C:/targets/sample.exe');

    await expect(authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    })).rejects.toThrow();

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny')).toBe(true);
  });

  it('allows target in hash allowlist (with matching capability)', async () => {
    const hash = 'b'.repeat(64);
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary', hashAllowlist: [hash] }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id, 'C:/targets/sample.exe');
    handle.repository.getAdapter().prepare('UPDATE targets SET hashes_json = ? WHERE id = ?').run(JSON.stringify({ sha256: hash }), target.id);

    const result = await authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    });

    expect(result.allowed).toBe(true);
  });

  it('isTargetAuthorized returns boolean without throwing', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'android' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    expect(authManager.isTargetAuthorized(target.id)).toBe(false);

    const boundaries2: AuthorizationBoundary = { ...defaultBoundaries, allowedTargets: [{ type: 'binary' }] };
    const authManager2 = createAuthManager(boundaries2, sessionManager);
    expect(authManager2.isTargetAuthorized(target.id)).toBe(true);
  });
});

describe('AuthorizationManager — restricted capability boundaries', () => {
  let sessionManager: SessionManager;

  beforeAll(() => {
    sessionManager = new SessionManager({ repository: handle.repository, evidenceEngine: new EvidenceEngine({ repository: handle.repository }) });
  });

  it('denies capability not in allowedCapabilities when list is non-empty', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary' }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    await expect(authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'android.manifest',
      operation: 'analysis'
    })).rejects.toThrow();

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny' && l.reason === 'capability-denied')).toBe(true);
  });

  it('allows capability that matches allowedCapabilities', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary' }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    const result = await authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    });

    expect(result.allowed).toBe(true);
  });

  it('allows capability matching provider prefix', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary' }],
      allowedCapabilities: [{ provider: 'binary' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    const result = await authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.symbols',
      operation: 'analysis'
    });

    expect(result.allowed).toBe(true);
  });

  it('denies capability with non-matching provider prefix', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary' }],
      allowedCapabilities: [{ provider: 'android' }]
    };
    const authManager = createAuthManager(boundaries, sessionManager);

    const session = createSessionWithTarget();
    const target = registerBinaryTarget(session.id);

    await expect(authManager.authorize({
      sessionId: session.id,
      targetId: target.id,
      capabilityId: 'binary.info',
      operation: 'analysis'
    })).rejects.toThrow();
  });

  it('denies unknown target id', async () => {
    const authManager = createAuthManager(defaultBoundaries, sessionManager);

    await expect(authManager.authorize({
      sessionId: 'ses_0000000000000000',
      targetId: 'tgt_ffffffffffffffff',
      capabilityId: 'binary.info',
      operation: 'analysis'
    })).rejects.toThrow();
  });
});

describe('AuthorizationManager — defaultBoundaries export', () => {
  it('is fail-closed: no targets authorized by default', () => {
    expect(defaultBoundaries.allowedTargets).toHaveLength(0);
    expect(defaultBoundaries.allowedCapabilities).toHaveLength(0);
  });

  it('has all required fields', () => {
    expect(defaultBoundaries.limits.maxMemoryMb).toBe(4096);
    expect(defaultBoundaries.dataHandling.allowExternalTransmission).toBe(false);
    expect(defaultBoundaries.requiresApproval).toContain('dynamic-execution');
  });
});
