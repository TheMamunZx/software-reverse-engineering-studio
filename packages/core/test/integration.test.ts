import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Repository } from '../src/storage/repository.js';
import { SessionManager } from '../src/engine/session-manager.js';
import { EvidenceEngine } from '../src/evidence/evidence-engine.js';
import { ProviderRegistry } from '../src/engine/capability-registry.js';
import { createAuthorizationManager, defaultBoundaries } from '../src/security/authorization.js';
import { createInvestigationOrchestrator, InvestigationOrchestrator } from '../src/engine/investigation-orchestrator.js';
import { AuthorizationError, NotFoundError } from '@sre-studio/shared';
import type { AuthorizationBoundary, AuthorizationRecord, InvestigationSession, SessionConfig, SessionProgress } from '../src/types/investigation.js';
import type { AnalysisTarget } from '../src/types/target.js';
import type { CapabilityProvider, AnalysisResult, AnalysisRequest } from '../src/types/provider.js';
import type { Finding } from '../src/types/evidence.js';

interface TempDbHandle {
  directory: string;
  repository: Repository;
}

let handle: TempDbHandle;
const extraRepos: Array<{ close(): void; cleanup(): void }> = [];

function createTempRepository(label: string): TempDbHandle {
  const directory = mkdtempSync(path.join(tmpdir(), `sre-studio-integration-${label}-`));
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
  description: 'Integration test authorization',
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

// A stub provider that returns deterministic findings for testing.
class StubProvider implements CapabilityProvider {
  readonly id = 'stub-provider';
  readonly name = 'Stub Provider';
  readonly version = '0.1.0';
  readonly description = 'Stub provider for integration tests';
  readonly capabilities = [
    {
      id: 'stub.info',
      name: 'Stub Info',
      description: 'Returns stub info findings',
      category: 'static-analysis' as const,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' }
    }
  ] as const;
  readonly requiredTools = [];

  analyzeCalls: AnalysisRequest[] = [];

  async initialize(): Promise<{ success: boolean; message?: string; availableCapabilities?: string[] }> {
    return { success: true, availableCapabilities: ['stub.info'] };
  }

  async validateEnvironment(): Promise<{ valid: boolean; availableTools: string[]; missingTools: string[]; warnings: string[] }> {
    return { valid: true, availableTools: [], missingTools: [], warnings: [] };
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    this.analyzeCalls.push(request);
    const finding: Omit<Finding, 'id' | 'createdAt' | 'updatedAt' | 'version'> = {
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: request.capabilityId,
      category: 'structure',
      severity: 'info',
      title: 'Stub finding',
      observation: 'Stub observation for ' + request.capabilityId,
      evidence: [],
      confidence: {
        level: 'high',
        value: 0.95,
        justification: 'Stub provider deterministic output',
        factors: []
      },
      limitations: [],
      unknowns: [],
      provenance: {
        derivedFrom: [],
        tool: 'stub-provider',
        command: 'stub --scan',
        parameters: request.parameters,
        duration: 5,
        toolVersion: '0.1.0'
      },
      reproducibility: {
        reproducible: true,
        environmentId: request.sessionId, // will be overridden with real env id in test
        steps: [],
        knownVariations: []
      },
      tags: [],
      createdBy: 'stub-provider'
    };
    return {
      findings: [finding],
      summary: 'Stub analysis complete',
      statistics: {
        findingsByCategory: { structure: 1 },
        findingsBySeverity: { info: 1 },
        evidenceCount: 0,
        avgConfidence: 0.95
      },
      duration: 5,
      toolOutputs: [],
      warnings: [],
      errors: []
    };
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}

// Builds an explicit fail-closed boundary that grants access to a single target + capability.
function explicitBoundaries(targetType: 'binary' | 'android' = 'binary', targetPath: string = 'C:/targets/sample.exe', capabilityId?: string): AuthorizationBoundary {
  return {
    ...defaultBoundaries,
    allowedTargets: [{ type: targetType, pathPattern: targetPath }],
    allowedCapabilities: capabilityId ? [{ capability: capabilityId }] : []
  };
}

function makeOrchestrator(repository: Repository, boundaries?: AuthorizationBoundary): {
  orchestrator: InvestigationOrchestrator;
  sessionManager: SessionManager;
  evidenceEngine: EvidenceEngine;
  stubProvider: StubProvider;
  authorizationManager: ReturnType<typeof createAuthorizationManager>;
} {
  const sessionManager = new SessionManager({
    repository,
    evidenceEngine: new EvidenceEngine({ repository })
  });
  const evidenceEngine = new EvidenceEngine({ repository });
  const providerRegistry = new ProviderRegistry();
  const stubProvider = new StubProvider();
  providerRegistry.register(stubProvider);
  const authorizationManager = createAuthorizationManager(boundaries ?? defaultBoundaries, sessionManager, repository);
  const orchestrator = createInvestigationOrchestrator({
    sessionManager,
    providerRegistry,
    evidenceEngine,
    authorizationManager
  });
  return { orchestrator, sessionManager, evidenceEngine, stubProvider, authorizationManager };
}

async function createStandardSession(
  sessionManager: SessionManager,
  targetPath: string = 'C:/targets/sample.exe',
  targetType: 'binary' | 'android' = 'binary'
): Promise<{ session: InvestigationSession; target: AnalysisTarget; envId: string }> {
  const session = await sessionManager.createSession({
    projectId: 'proj_e2e',
    name: 'Integration session',
    targets: [],
    authorization,
    status: 'initialized',
    progress: defaultProgress,
    config: sessionConfig,
    createdBy: 'e2e-test'
  });
  const target = sessionManager.registerTarget(session.id, {
    type: targetType,
    path: targetPath,
    metadata: {},
    hashes: { sha256: 'h'.repeat(64) },
    authorization,
    role: 'primary'
  });
  const env = sessionManager['repository'].createEnvironment({
    sessionId: session.id,
    os: process.platform,
    arch: process.arch,
    tools: [],
    providerVersions: {},
    targetHash: 'e'.repeat(64)
  });
  return { session, target, envId: env.id };
}

describe('Core Engine — end-to-end investigation flow', () => {
  let orchestrator: InvestigationOrchestrator;
  let sessionManager: SessionManager;
  let evidenceEngine: EvidenceEngine;
  let stubProvider: StubProvider;
  let authorizationManager: ReturnType<typeof createAuthorizationManager>;

  beforeAll(() => {
    // Default orchestrator uses fail-closed defaultBoundaries (no targets/caps allowed).
    ({ orchestrator, sessionManager, evidenceEngine, stubProvider, authorizationManager } = makeOrchestrator(handle.repository));
  });

  it('starts an investigation with explicitly authorized target', async () => {
    // Configure explicit authorization for the target being initialized.
    authorizationManager.updateBoundaries(explicitBoundaries('binary', 'C:/targets/sample.exe'));

    const session = await orchestrator.startInvestigation({
      projectId: 'proj_e2e',
      name: 'E2E investigation',
      target: { type: 'binary', path: 'C:/targets/sample.exe', hash: 'h'.repeat(64) },
      scope: 'Full static analysis',
      authorization: {
        type: 'owner',
        description: 'Owner-authorized testing',
        documentRef: '/docs/auth.md'
      },
      createdBy: 'e2e-test'
    });

    expect(session.id).toMatch(/^ses_[0-9a-f]{16}$/);
    expect(session.status).toBe('initialized');
    expect(session.targets).toHaveLength(1);
    expect(session.targets[0].targetId).toMatch(/^tgt_[0-9a-f]{16}$/);
    expect(session.authorization.type).toBe('owner');
  });

  it('startInvestigation is denied without explicit target authorization (fail-closed)', async () => {
    // Use a fresh orchestrator with fail-closed defaults (no boundaries configured).
    const directory = mkdtempSync(path.join(tmpdir(), 'sre-studio-integration-failclosed-'));
    const failClosedRepo = new Repository({ dbPath: path.join(directory, 'investigation.db') });
    extraRepos.push({
      close: () => failClosedRepo.close(),
      cleanup: () => rmSync(directory, { recursive: true, force: true })
    });

    const failClosedSessionManager = new SessionManager({
      repository: failClosedRepo,
      evidenceEngine: new EvidenceEngine({ repository: failClosedRepo })
    });
    const failClosedEvidenceEngine = new EvidenceEngine({ repository: failClosedRepo });
    const failClosedRegistry = new ProviderRegistry();
    failClosedRegistry.register(new StubProvider());
    const failClosedAuth = createAuthorizationManager(defaultBoundaries, failClosedSessionManager, failClosedRepo);
    const failClosedOrchestrator = createInvestigationOrchestrator({
      sessionManager: failClosedSessionManager,
      providerRegistry: failClosedRegistry,
      evidenceEngine: failClosedEvidenceEngine,
      authorizationManager: failClosedAuth
    });

    // No explicit target authorization: startInvestigation must be denied.
    await expect(failClosedOrchestrator.startInvestigation({
      projectId: 'proj_failclosed',
      name: 'Fail-closed session',
      target: { type: 'binary', path: 'C:/targets/any.exe' },
      scope: 'Should fail',
      authorization: { type: 'owner', description: 'Auth' },
      createdBy: 'e2e-test'
    })).rejects.toThrow(AuthorizationError);
  });

  it('runs analysis and stores findings with real SQLite when explicitly authorized', async () => {
    const { session, target, envId } = await createStandardSession(sessionManager, 'C:/targets/analysis.exe');

    // Configure explicit capability authorization for this session's target.
    authorizationManager.updateBoundaries(explicitBoundaries('binary', 'C:/targets/analysis.exe', 'stub.info'));

    // Override stub provider reproducibility to use real environment ID
    const originalAnalyze = stubProvider.analyze.bind(stubProvider);
    stubProvider.analyze = async (request: AnalysisRequest) => {
      const result = await originalAnalyze(request);
      result.findings = result.findings.map(f => ({
        ...f,
        reproducibility: { ...f.reproducibility, environmentId: envId }
      }));
      return result;
    };

    const result = await orchestrator.runAnalysis({
      sessionId: session.id,
      capabilityId: 'stub.info',
      parameters: { deep: true }
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('Stub finding');
    expect(result.findings[0].confidence.level).toBe('high');
    expect(result.findings[0].confidence.value).toBe(0.95);
    expect(result.findings[0].provenance.tool).toBe('stub-provider');
    expect(result.summary).toBe('Stub analysis complete');

    // Verify finding persisted in SQLite
    const loaded = evidenceEngine.getFinding(result.findings[0].id);
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe(session.id);
    expect(loaded?.targetId).toBe(target.id);

    // Verify session progress updated
    const updated = sessionManager.getSession(session.id);
    expect(updated?.progress.completedSteps).toBeGreaterThanOrEqual(1);
  });

  it('runAnalysis is denied when capability is not explicitly authorized', async () => {
    const { session } = await createStandardSession(sessionManager, 'C:/targets/capdeny.exe');

    // Authorize the target but NOT the capability.
    authorizationManager.updateBoundaries(explicitBoundaries('binary', 'C:/targets/capdeny.exe'));

    await expect(orchestrator.runAnalysis({
      sessionId: session.id,
      capabilityId: 'stub.info',
      parameters: {}
    })).rejects.toThrow(AuthorizationError);

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.logs.some(l => l.decision === 'deny' && l.reason === 'capability-denied')).toBe(true);
  });

  it('lists capabilities from registered providers', async () => {
    const capabilities = await orchestrator.getCapabilities();
    expect(capabilities.length).toBeGreaterThanOrEqual(1);
    expect(capabilities.some(c => c.id === 'stub.info')).toBe(true);
  });

  it('closes an investigation', async () => {
    const { session } = await createStandardSession(sessionManager, 'C:/targets/close.exe');

    const closed = await orchestrator.closeInvestigation(session.id, 'completed');
    expect(closed?.status).toBe('completed');

    const loaded = orchestrator.getSession(session.id);
    expect(loaded?.status).toBe('completed');
  });

  it('getSessionOrThrow throws NotFoundError for unknown session', () => {
    expect(() => orchestrator.getSessionOrThrow('ses_ffffffffffffffff')).toThrow(NotFoundError);
  });

  it('runAnalysis throws AuthorizationError when target is denied by boundaries', async () => {
    // Restricted boundaries: only android targets allowed
    const directory = mkdtempSync(path.join(tmpdir(), 'sre-studio-integration-restricted-'));
    const restrictedRepo = new Repository({ dbPath: path.join(directory, 'investigation.db') });
    extraRepos.push({
      close: () => restrictedRepo.close(),
      cleanup: () => rmSync(directory, { recursive: true, force: true })
    });

    const restrictedSessionManager = new SessionManager({
      repository: restrictedRepo,
      evidenceEngine: new EvidenceEngine({ repository: restrictedRepo })
    });
    const restrictedEvidenceEngine = new EvidenceEngine({ repository: restrictedRepo });
    const restrictedRegistry = new ProviderRegistry();
    restrictedRegistry.register(new StubProvider());
    const restrictedAuth = createAuthorizationManager(
      { ...defaultBoundaries, allowedTargets: [{ type: 'android' }] },
      restrictedSessionManager,
      restrictedRepo
    );
    const restrictedOrchestrator = createInvestigationOrchestrator({
      sessionManager: restrictedSessionManager,
      providerRegistry: restrictedRegistry,
      evidenceEngine: restrictedEvidenceEngine,
      authorizationManager: restrictedAuth
    });

    // startInvestigation registers a binary target, which is denied by boundaries.
    await expect(restrictedOrchestrator.startInvestigation({
      projectId: 'proj_restricted',
      name: 'Restricted session',
      target: { type: 'binary', path: 'C:/targets/denied.exe' },
      scope: 'Should fail',
      authorization: { type: 'owner', description: 'Auth' },
      createdBy: 'e2e-test'
    })).rejects.toThrow(AuthorizationError);
  });

  it('runAnalysis throws NotFoundError for unknown session', async () => {
    await expect(orchestrator.runAnalysis({
      sessionId: 'ses_ffffffffffffffff',
      capabilityId: 'stub.info',
      parameters: {}
    })).rejects.toThrow(NotFoundError);
  });

  it('audit log records authorization decisions (allow and deny)', async () => {
    const { session } = await createStandardSession(sessionManager, 'C:/targets/audit.exe');

    // Authorize the target and capability
    authorizationManager.updateBoundaries(explicitBoundaries('binary', 'C:/targets/audit.exe', 'stub.info'));

    // Allowed operation
    await orchestrator.runAnalysis({
      sessionId: session.id,
      capabilityId: 'stub.info',
      parameters: {}
    });

    // Denied operation (different capability not authorized)
    await expect(orchestrator.runAnalysis({
      sessionId: session.id,
      capabilityId: 'android.manifest',
      parameters: {}
    })).rejects.toThrow(AuthorizationError);

    const logs = handle.repository.queryAuditLogs({ sessionId: session.id });
    expect(logs.total).toBeGreaterThanOrEqual(1);
    expect(logs.logs.some(l => l.decision === 'allow' && l.operation === 'analysis')).toBe(true);
    expect(logs.logs.some(l => l.decision === 'deny' && l.reason === 'capability-denied')).toBe(true);
  });
});
