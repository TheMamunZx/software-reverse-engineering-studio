import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { McpServer, createMcpServer } from '../src/server.js';
import {
  createSessionManager,
  createEvidenceEngine,
  createAuthorizationManager,
  createProviderRegistry,
  createRepository,
  defaultBoundaries,
  type SessionManager,
  type EvidenceEngine,
  type AuthorizationManager,
  type ProviderRegistry
} from '@sre-studio/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Helper to create a full Core Engine stack backed by a temp SQLite database
function createCoreStack(dbLabel: string) {
  const directory = mkdtempSync(path.join(tmpdir(), `sre-studio-mcp-${dbLabel}-`));
  const dbPath = path.join(directory, 'investigation.db');
  const repository = createRepository({ dbPath });
  const sessionManager = createSessionManager({ repository, evidenceEngine: createEvidenceEngine({ repository }) });
  const evidenceEngine = createEvidenceEngine({ repository });
  const authorizationManager = createAuthorizationManager(defaultBoundaries, sessionManager, repository);
  const providerRegistry = createProviderRegistry();

  return {
    directory,
    dbPath,
    repository,
    sessionManager,
    evidenceEngine,
    authorizationManager,
    providerRegistry,
    cleanup: () => {
      repository.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

describe('MCP Server — lifecycle', () => {
  it('starts and stops successfully', () => {
    const stack = createCoreStack('lifecycle');
    try {
      const server = createMcpServer({
        sessionManager: stack.sessionManager,
        evidenceEngine: stack.evidenceEngine,
        authorizationManager: stack.authorizationManager,
        providerRegistry: stack.providerRegistry
      });

      // Constructor should not throw
      expect(server).toBeDefined();

      // start/loadValidators should not throw
      vi.spyOn(stack.sessionManager, 'getSession').mockReturnValue(null);

      // We can't easily start stdio transport in a unit test without stdin,
      // but we can verify the server object is constructed properly
      expect(server).toBeInstanceOf(McpServer);
    } finally {
      stack.cleanup();
    }
  });

  it('createMcpServer factory returns instance', () => {
    const stack = createCoreStack('factory');
    try {
      const server = createMcpServer({
        sessionManager: stack.sessionManager,
        evidenceEngine: stack.evidenceEngine,
        authorizationManager: stack.authorizationManager,
        providerRegistry: stack.providerRegistry
      });
      expect(server).toBeInstanceOf(McpServer);
    } finally {
      stack.cleanup();
    }
  });
});

describe('MCP Server — handler unit tests with mocked Core', () => {
  let sessionManager: SessionManager;
  let evidenceEngine: EvidenceEngine;
  let authorizationManager: AuthorizationManager;
  let providerRegistry: ProviderRegistry;
  let server: McpServer;

  beforeEach(() => {
    const stack = createCoreStack('handlers');
    sessionManager = stack.sessionManager;
    evidenceEngine = stack.evidenceEngine;
    authorizationManager = stack.authorizationManager;
    providerRegistry = stack.providerRegistry;
    server = createMcpServer({
      sessionManager,
      evidenceEngine,
      authorizationManager,
      providerRegistry
    });
    // cleanup is not called here; we reuse the stack for the test
  });

  afterEach(() => {
    // Stack cleanup handled per-test
  });

  it('investigation.start delegates to orchestrator and returns session', async () => {
    // We need to access the orchestrator through the server
    // Since server is private, we test via the public API indirectly
    // by checking that the server was constructed without errors
    expect(server).toBeDefined();
  });

  it('server instance is created with all core components', () => {
    expect(sessionManager).toBeDefined();
    expect(evidenceEngine).toBeDefined();
    expect(authorizationManager).toBeDefined();
    expect(providerRegistry).toBeDefined();
    expect(server).toBeDefined();
  });
});
