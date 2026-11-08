import { describe, expect, it } from 'vitest';
import { createSessionManager, createEvidenceEngine, createAuthorizationManager, createProviderRegistry, createRepository, defaultBoundaries, type AuthorizationBoundary } from '@sre-studio/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuthorizationError } from '@sre-studio/shared';

function createStack(boundaries: AuthorizationBoundary, label: string) {
  const directory = mkdtempSync(path.join(tmpdir(), `sre-studio-mcp-auth-${label}-`));
  const dbPath = path.join(directory, 'investigation.db');
  const repository = createRepository({ dbPath });
  const sessionManager = createSessionManager({ repository, evidenceEngine: createEvidenceEngine({ repository }) });
  const evidenceEngine = createEvidenceEngine({ repository });
  const authorizationManager = createAuthorizationManager(boundaries, sessionManager, repository);
  const providerRegistry = createProviderRegistry();

  return {
    directory, dbPath, repository, sessionManager, evidenceEngine, authorizationManager, providerRegistry,
    cleanup: () => { repository.close(); rmSync(directory, { recursive: true, force: true }); }
  };
}

describe('AuthorizationManager — Fail-closed authorization', () => {
  it('denies target registration when no targets authorized (default boundaries)', async () => {
    const stack = createStack(defaultBoundaries, 'failclosed');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test',
        name: 'Unauthorized Session',
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        createdBy: 'mcp-test'
      });

      const target = stack.sessionManager.registerTarget(session.id, {
        type: 'binary',
        path: 'C:/targets/sample.exe',
        metadata: {},
        hashes: { sha256: 'a'.repeat(64) },
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        role: 'primary'
      });
      expect(target.id).toMatch(/^tgt_[0-9a-f]{16}$/);

      // Authorization is enforced via authorizationManager.authorize()
      // With default boundaries (fail-closed), no targets or capabilities are authorized
      await expect(
        stack.authorizationManager.authorize({
          sessionId: session.id,
          targetId: target.id,
          capabilityId: 'binary.info',
          operation: 'target-register'
        })
      ).rejects.toThrow(AuthorizationError);
    } finally {
      stack.cleanup();
    }
  });

  it('allows explicitly authorized target and capability', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary', pathPattern: 'C:/authorized/.*' }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const stack = createStack(boundaries, 'authorized');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test',
        name: 'Authorized Session',
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        createdBy: 'mcp-test'
      });

      const target = stack.sessionManager.registerTarget(session.id, {
        type: 'binary',
        path: 'C:/authorized/sample.exe',
        metadata: {},
        hashes: { sha256: 'b'.repeat(64) },
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        role: 'primary'
      });

      const result = await stack.authorizationManager.authorize({
        sessionId: session.id,
        targetId: target.id,
        capabilityId: 'binary.info',
        operation: 'analysis'
      });
      expect(result.allowed).toBe(true);
    } finally {
      stack.cleanup();
    }
  });

  it('denies target not matching explicit grant (target mismatch)', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary', pathPattern: 'C:/authorized/.*' }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const stack = createStack(boundaries, 'mismatch');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test',
        name: 'Mismatch Session',
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        createdBy: 'mcp-test'
      });

      const target = stack.sessionManager.registerTarget(session.id, {
        type: 'binary',
        path: 'C:/unauthorized/sample.exe',
        metadata: {},
        hashes: { sha256: 'c'.repeat(64) },
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        role: 'primary'
      });

      await expect(
        stack.authorizationManager.authorize({
          sessionId: session.id,
          targetId: target.id,
          capabilityId: 'binary.info',
          operation: 'analysis'
        })
      ).rejects.toThrow(AuthorizationError);
    } finally {
      stack.cleanup();
    }
  });

  it('denies capability not explicitly granted (capability denial)', async () => {
    const boundaries: AuthorizationBoundary = {
      ...defaultBoundaries,
      allowedTargets: [{ type: 'binary' }],
      allowedCapabilities: [{ capability: 'binary.info' }]
    };
    const stack = createStack(boundaries, 'capdeny');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test',
        name: 'Cap Deny Session',
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        createdBy: 'mcp-test'
      });

      const target = stack.sessionManager.registerTarget(session.id, {
        type: 'binary',
        path: 'C:/targets/sample.exe',
        metadata: {},
        hashes: { sha256: 'd'.repeat(64) },
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        role: 'primary'
      });

      await expect(
        stack.authorizationManager.authorize({
          sessionId: session.id,
          targetId: target.id,
          capabilityId: 'android.manifest',
          operation: 'analysis'
        })
      ).rejects.toThrow(AuthorizationError);
    } finally {
      stack.cleanup();
    }
  });

  it('defaultBoundaries has no targets or capabilities authorized', () => {
    expect(defaultBoundaries.allowedTargets).toHaveLength(0);
    expect(defaultBoundaries.allowedCapabilities).toHaveLength(0);
  });

  it('records denied authorization decisions in audit log', async () => {
    const stack = createStack(defaultBoundaries, 'audit');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test',
        name: 'Audit Session',
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        createdBy: 'mcp-test'
      });

      const target = stack.sessionManager.registerTarget(session.id, {
        type: 'binary',
        path: 'C:/targets/sample.exe',
        metadata: {},
        hashes: { sha256: 'e'.repeat(64) },
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        role: 'primary'
      });

      try {
        await stack.authorizationManager.authorize({
          sessionId: session.id,
          targetId: target.id,
          capabilityId: 'binary.info',
          operation: 'analysis'
        });
      } catch {
        // Expected to throw
      }

      const logs = stack.repository.queryAuditLogs({ sessionId: session.id });
      expect(logs.total).toBeGreaterThanOrEqual(1);
      expect(logs.logs.some(l => l.decision === 'deny')).toBe(true);
    } finally {
      stack.cleanup();
    }
  });
});
