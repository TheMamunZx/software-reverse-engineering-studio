import { describe, expect, it } from 'vitest';
import { McpServer, createMcpServer } from '../src/server.js';
import {
  createSessionManager,
  createEvidenceEngine,
  createAuthorizationManager,
  createProviderRegistry,
  createRepository,
  defaultBoundaries,
  type AuthorizationBoundary
} from '@sre-studio/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function createStack(label: string) {
  const directory = mkdtempSync(path.join(tmpdir(), `sre-studio-mcp-${label}-`));
  const dbPath = path.join(directory, 'investigation.db');
  const repository = createRepository({ dbPath });
  const sessionManager = createSessionManager({ repository, evidenceEngine: createEvidenceEngine({ repository }) });
  const evidenceEngine = createEvidenceEngine({ repository });
  const authorizationManager = createAuthorizationManager(defaultBoundaries, sessionManager, repository);
  const providerRegistry = createProviderRegistry();

  return {
    directory, dbPath, repository, sessionManager, evidenceEngine, authorizationManager, providerRegistry,
    cleanup: () => { repository.close(); rmSync(directory, { recursive: true, force: true }); }
  };
}

describe('Core Engine — Delegation to MCP Server', () => {
  it('creates MCP server with all Core components wired', () => {
    const stack = createStack('delegation');
    try {
      const server = createMcpServer({
        sessionManager: stack.sessionManager,
        evidenceEngine: stack.evidenceEngine,
        authorizationManager: stack.authorizationManager,
        providerRegistry: stack.providerRegistry
      });
      expect(server).toBeDefined();
      expect(stack.sessionManager).toBeDefined();
      expect(stack.evidenceEngine).toBeDefined();
      expect(stack.authorizationManager).toBeDefined();
      expect(stack.providerRegistry).toBeDefined();
    } finally {
      stack.cleanup();
    }
  });

  it('creates session via SessionManager with status initialized', async () => {
    const stack = createStack('delegation-session');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test',
        name: 'Delegation Test',
        authorization: {
          type: 'owner',
          description: 'Test authorization',
          scope: ['C:/targets/sample.exe'],
          limitations: [],
          verified: true
        },
        createdBy: 'mcp-test'
      });
      expect(session.id).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(session.status).toBe('initialized');
      expect(session.projectId).toBe('proj_test');
      expect(session.name).toBe('Delegation Test');
    } finally {
      stack.cleanup();
    }
  });

  it('registers target via repository and session manager', async () => {
    const stack = createStack('delegation-target');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test',
        name: 'Target Test',
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        createdBy: 'mcp-test'
      });

      const target = stack.repository.registerTarget(session.id, {
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
      expect(target.sessionId).toBe(session.id);

      const loaded = stack.sessionManager.getSession(session.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.targets).toHaveLength(1);
      expect(loaded!.targets[0].targetId).toBe(target.id);
    } finally {
      stack.cleanup();
    }
  });

  it('evidenceEngine queryFindings returns empty for session with no findings', async () => {
    const stack = createStack('delegation-evidence-empty');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test',
        name: 'Empty Evidence',
        authorization: {
          type: 'owner',
          description: 'Test',
          scope: [],
          limitations: [],
          verified: true
        },
        createdBy: 'mcp-test'
      });

      const result = stack.evidenceEngine.queryFindings({ sessionId: session.id });
      expect(result.total).toBe(0);
      expect(result.findings).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    } finally {
      stack.cleanup();
    }
  });
});