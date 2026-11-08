/**
 * Security Audit Test Suite
 *
 * Validates security boundaries, fail-closed authorization, target path
 * validation, subprocess argument safety, output buffer limits, resource limit
 * enforcement, and error resilience.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRepository,
  createSessionManager,
  createEvidenceEngine,
  createAuthorizationManager,
  createProviderRegistry,
  createInvestigationOrchestrator,
  defaultBoundaries,
  type AuthorizationBoundary,
  type InvestigationSession,
} from '../src/index.js';
import { AuthorizationError, ToolExecutionError, ProviderError } from '@sre-studio/shared';
import { spawnSync } from 'node:child_process';

describe('Security Audit — Subprocess Execution Safety', () => {
  it('enforces shell: false so shell metacharacters are treated literally', () => {
    // Attempt shell command chaining via argument
    // If shell: false is enforced, node tries to pass the literal string to the executable
    const isWin = process.platform === 'win32';
    const echoCmd = isWin ? 'cmd.exe' : 'echo';
    const maliciousArg = 'hello & echo INJECTED_COMMAND_EXECUTED';

    const result = spawnSync(echoCmd, isWin ? ['/c', 'echo', maliciousArg] : [maliciousArg], {
      shell: false,
      encoding: 'utf-8',
      timeout: 5000,
    });

    // In a safe invocation with argument arrays, the injected command is NOT separately executed
    expect(result.stdout).not.toMatch(/^INJECTED_COMMAND_EXECUTED/m);
  });

  it('rejects commands that do not exist with a structured ENOENT error', () => {
    const nonExistentCommand = 'sre_non_existent_tool_binary_xyz_12345';
    const result = spawnSync(nonExistentCommand, ['--version'], {
      shell: false,
      encoding: 'utf-8',
    });

    expect(result.error).toBeDefined();
    expect((result.error as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('enforces maxBuffer limit on subprocess output to prevent memory exhaustion', () => {
    // Generate output larger than maxBuffer
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : 'yes';
    const args = isWin ? ['/c', 'for /L %i in (1,1,1000) do @echo 12345678901234567890'] : [];

    const result = spawnSync(cmd, args, {
      shell: false,
      encoding: 'utf-8',
      maxBuffer: 256, // small limit to trigger buffer overflow
    });

    expect(result.error).toBeDefined();
    expect((result.error as NodeJS.ErrnoException).code).toMatch(/ENOBUFS|ERR_CHILD_PROCESS_STDIO_MAXBUFFER/);
  });
});

describe('Security Audit — Authorization & Target Path Validation', () => {
  let tmpDir: string;
  let dbPath: string;
  let repository: ReturnType<typeof createRepository>;
  let evidenceEngine: ReturnType<typeof createEvidenceEngine>;
  let sessionManager: ReturnType<typeof createSessionManager>;
  let session: InvestigationSession;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'sre-studio-sec-audit-'));
    dbPath = path.join(tmpDir, 'investigation.db');
    repository = createRepository({ dbPath });
    evidenceEngine = createEvidenceEngine({ repository });
    sessionManager = createSessionManager({ repository, evidenceEngine });

    session = await sessionManager.createSession({
      projectId: 'proj_sec_audit',
      name: 'Security Audit Session',
      targets: [],
      authorization: {
        type: 'authorized-testing',
        description: 'Security audit test',
        scope: ['*'],
        limitations: [],
        verified: true,
      },
      status: 'initialized',
      progress: {
        totalSteps: 0,
        completedSteps: 0,
        findingsCount: 0,
        evidenceCount: 0,
        errors: [],
      },
      config: {
        providers: [],
        resourceLimits: {
          maxMemoryMb: 4096,
          maxCpuPercent: 80,
          maxDurationMs: 300000,
          maxConcurrentAnalyses: 10,
          maxDiskUsageMb: 2048,
        },
      },
      createdBy: 'sec-auditor',
    });
  });

  afterAll(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails closed when defaultBoundaries has empty allowedTargets', async () => {
    const authManager = createAuthorizationManager(defaultBoundaries, sessionManager, repository);

    const target = sessionManager.registerTarget(session.id, {
      type: 'binary',
      path: 'C:/legitimate/sample.exe',
      role: 'primary',
      metadata: {},
      hashes: { sha256: 'a'.repeat(64) },
      authorization: session.authorization,
    });

    await expect(
      authManager.authorize({
        sessionId: session.id,
        targetId: target.id,
        capabilityId: 'binary.info',
        operation: 'analysis',
      })
    ).rejects.toThrow(AuthorizationError);

    // Verify denial was logged to SQLite audit log
    const { logs: auditLogs } = repository.queryAuditLogs({ sessionId: session.id });
    expect(auditLogs.length).toBeGreaterThan(0);
    const latest = auditLogs[0];
    expect(latest?.decision).toBe('deny');
    expect(latest?.reason).toBe('target-denied');
  });

  it('denies targets attempting directory traversal outside allowed boundary', async () => {
    const customBoundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [
        {
          type: 'binary',
          pathPattern: 'C:/allowed/workspace/*',
        },
      ],
      allowedCapabilities: [{ provider: 'binary' }],
    };

    const authManager = createAuthorizationManager(customBoundaries, sessionManager, repository);

    // Traversal path attempting to escape
    const traversalTarget = sessionManager.registerTarget(session.id, {
      type: 'binary',
      path: 'C:/allowed/workspace/../../Windows/System32/cmd.exe',
      role: 'primary',
      metadata: {},
      hashes: { sha256: 'a'.repeat(64) },
      authorization: session.authorization,
    });

    await expect(
      authManager.authorize({
        sessionId: session.id,
        targetId: traversalTarget.id,
        capabilityId: 'binary.info',
        operation: 'analysis',
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies symlinks or junctions resolving to files outside the authorized directory', async () => {
    const allowedDir = path.join(tmpDir, 'allowed-zone');
    const outsideDir = path.join(tmpDir, 'outside-zone');
    mkdirSync(allowedDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    const secretFile = path.join(outsideDir, 'unauthorized-target.exe');
    writeFileSync(secretFile, 'MZ_DUMMY_BINARY_DATA');

    // Create a junction or file symlink inside allowedDir pointing outside
    let targetPathToTest: string;
    try {
      const linkFile = path.join(allowedDir, 'symlink-target.exe');
      symlinkSync(secretFile, linkFile, 'file');
      targetPathToTest = linkFile;
    } catch {
      // Standard users on Windows without Developer Mode can create directory junctions
      const junctionDir = path.join(allowedDir, 'junction-folder');
      symlinkSync(outsideDir, junctionDir, 'junction');
      targetPathToTest = path.join(junctionDir, 'unauthorized-target.exe');
    }

    const customBoundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [
        {
          type: 'binary',
          pathPattern: `${allowedDir.replace(/\\/g, '/')}/*`,
        },
      ],
      allowedCapabilities: [{ provider: 'binary' }],
    };

    const authManager = createAuthorizationManager(customBoundaries, sessionManager, repository);

    const escapingTarget = sessionManager.registerTarget(session.id, {
      type: 'binary',
      path: targetPathToTest,
      role: 'primary',
      metadata: {},
      hashes: { sha256: 'b'.repeat(64) },
      authorization: session.authorization,
    });

    // Despite target.path syntactically starting with allowedDir, canonical resolution detects escape
    await expect(
      authManager.authorize({
        sessionId: session.id,
        targetId: escapingTarget.id,
        capabilityId: 'binary.info',
        operation: 'analysis',
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies targets with mismatched SHA-256 when hash allowlist is enforced', async () => {
    const legitimateHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const tamperedHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    const customBoundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [
        {
          type: 'binary',
          pathPattern: '*',
          hashAllowlist: [legitimateHash],
        },
      ],
      allowedCapabilities: [{ provider: 'binary' }],
    };

    const authManager = createAuthorizationManager(customBoundaries, sessionManager, repository);

    const tamperedTarget = sessionManager.registerTarget(session.id, {
      type: 'binary',
      path: 'C:/allowed/sample.exe',
      role: 'primary',
      metadata: {},
      hashes: { sha256: tamperedHash },
      authorization: session.authorization,
    });

    await expect(
      authManager.authorize({
        sessionId: session.id,
        targetId: tamperedTarget.id,
        capabilityId: 'binary.info',
        operation: 'analysis',
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it('enforces concurrency resource limits on analysis operations', async () => {
    const customBoundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: '*' }],
      allowedCapabilities: [{ capability: 'binary.info' }],
      limits: {
        ...defaultBoundaries.limits,
        maxConcurrentAnalyses: 1, // Allow at most 1 concurrent analysis
      },
    };

    const authManager = createAuthorizationManager(customBoundaries, sessionManager, repository);

    const validTarget = sessionManager.registerTarget(session.id, {
      type: 'binary',
      path: 'C:/safe/sample.exe',
      role: 'primary',
      metadata: {},
      hashes: { sha256: 'a'.repeat(64) },
      authorization: session.authorization,
    });

    // Simulate 1 active analysis
    authManager.beginAnalysis();

    // Second analysis should be denied due to concurrency limit
    await expect(
      authManager.authorize({
        sessionId: session.id,
        targetId: validTarget.id,
        capabilityId: 'binary.info',
        operation: 'analysis',
      })
    ).rejects.toThrow(AuthorizationError);

    const { logs: auditLogs } = repository.queryAuditLogs({ sessionId: session.id });
    const lastDenial = auditLogs.find((l) => l.reason === 'resource-limit');
    expect(lastDenial).toBeDefined();

    // Release the analysis slot
    authManager.endAnalysis();

    // Now it should pass
    const result = await authManager.authorize({
      sessionId: session.id,
      targetId: validTarget.id,
      capabilityId: 'binary.info',
      operation: 'analysis',
    });
    expect(result.allowed).toBe(true);
  });

  it('enforces memory resource limits when configured below process RSS', async () => {
    const customBoundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: '*' }],
      allowedCapabilities: [{ capability: 'binary.info' }],
      limits: {
        ...defaultBoundaries.limits,
        maxMemoryMb: 1, // Set to 1MB, which is well below the running Node process memory
      },
    };

    const authManager = createAuthorizationManager(customBoundaries, sessionManager, repository);

    const memTarget = sessionManager.registerTarget(session.id, {
      type: 'binary',
      path: 'C:/safe/sample-mem.exe',
      role: 'primary',
      metadata: {},
      hashes: { sha256: 'a'.repeat(64) },
      authorization: session.authorization,
    });

    await expect(
      authManager.authorize({
        sessionId: session.id,
        targetId: memTarget.id,
        capabilityId: 'binary.info',
        operation: 'analysis',
      })
    ).rejects.toThrow(AuthorizationError);
  });
});
