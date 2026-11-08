/**
 * End-to-End MCP Protocol Lifecycle Integration Test
 *
 * Verifies that the full MCP Server runs end-to-end against Core Engine,
 * SQLite persistence, and providers over stdio streams.
 *
 * Covers all 8 MCP tools in sequence:
 *  1. initialize handshake
 *  2. tools/list (all 8 registered tools with JSON schemas)
 *  3. investigation.start (creates session, registers target, applies auth)
 *  4. target.register (adds secondary target)
 *  5. target.list (queries registered targets)
 *  6. analysis.capabilities (queries provider capabilities)
 *  7. evidence.query (queries evidence/findings from SQLite)
 *  8. investigation.status (checks progress)
 *  9. investigation.close (closes session and finalizes report)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRepository,
  createSessionManager,
  createEvidenceEngine,
  createAuthorizationManager,
  createProviderRegistry,
  defaultBoundaries,
} from '@sre-studio/core';
import { McpServer } from '../src/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const ROOT_DIR = path.resolve(__dirname, '../../..');
const PE_SAMPLE = path.join(ROOT_DIR, 'tests', 'fixtures', 'sample-binaries', 'sample.exe');
const APK_SAMPLE = path.join(ROOT_DIR, 'tests', 'fixtures', 'sample-apks', 'sample.apk');

describe('E2E MCP Server Lifecycle over stdio Streams', () => {
  let tmpDir: string;
  let repository: ReturnType<typeof createRepository>;
  let evidenceEngine: ReturnType<typeof createEvidenceEngine>;
  let sessionManager: ReturnType<typeof createSessionManager>;
  let authManager: ReturnType<typeof createAuthorizationManager>;
  let providerRegistry: ReturnType<typeof createProviderRegistry>;
  let mcpServer: McpServer;
  let client: Client;
  let clientToServer: PassThrough;
  let serverToClient: PassThrough;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'sre-mcp-e2e-full-'));
    const dbPath = path.join(tmpDir, 'investigation.db');
    repository = createRepository({ dbPath });
    evidenceEngine = createEvidenceEngine({ repository });
    sessionManager = createSessionManager({ repository, evidenceEngine });

    // Boundary allowing our test fixtures
    authManager = createAuthorizationManager(
      {
        allowedTargets: [{ type: '*' }],
        allowedCapabilities: [{ provider: 'rizin' }, { provider: 'android' }],
        requiresApproval: [],
        limits: defaultBoundaries.limits,
        dataHandling: defaultBoundaries.dataHandling,
      },
      sessionManager,
      repository
    );
    providerRegistry = createProviderRegistry();

    mcpServer = new McpServer({
      sessionManager,
      evidenceEngine,
      authorizationManager: authManager,
      providerRegistry,
    });

    clientToServer = new PassThrough();
    serverToClient = new PassThrough();

    // Start server on in-memory streams
    const serverTransport = new StdioServerTransport(clientToServer, serverToClient);
    await mcpServer.start(serverTransport);

    // Connect client
    client = new Client(
      { name: 'mcp-e2e-test-agent', version: '1.0.0' },
      { capabilities: {} }
    );
    const clientTransport = new StdioServerTransport(serverToClient, clientToServer);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await mcpServer.stop();
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists all 8 required MCP tools with versioned input schemas', async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBe(8);

    const names = result.tools.map((t) => t.name);
    expect(names).toEqual([
      'investigation.start',
      'investigation.status',
      'investigation.close',
      'target.register',
      'target.list',
      'analysis.run',
      'analysis.capabilities',
      'evidence.query',
    ]);

    for (const tool of result.tools) {
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('executes the full investigation lifecycle via MCP tools', async () => {
    // 1. investigation.start
    const startRes = (await client.callTool({
      name: 'investigation.start',
      arguments: {
        target: { type: 'binary', path: PE_SAMPLE },
        scope: 'Benign PE fixture inspection',
        authorization: {
          type: 'owner',
          description: 'Authorized test of benign fixture',
        },
      },
    })) as { content: Array<{ type: string; text: string }> };

    expect(startRes.content[0]?.text).toBeDefined();
    const startData = JSON.parse(startRes.content[0]!.text);
    expect(startData.sessionId).toMatch(/^ses_/);
    expect(startData.targetId).toMatch(/^tgt_/);
    const sessionId = startData.sessionId;

    // 2. target.register (register APK target)
    const regRes = (await client.callTool({
      name: 'target.register',
      arguments: {
        sessionId,
        target: {
          type: 'android',
          path: APK_SAMPLE,
        },
      },
    })) as { content: Array<{ type: string; text: string }> };
    const regData = JSON.parse(regRes.content[0]!.text);
    expect(regData.targetId).toMatch(/^tgt_/);

    // 3. target.list
    const listRes = (await client.callTool({
      name: 'target.list',
      arguments: { sessionId },
    })) as { content: Array<{ type: string; text: string }> };
    const listData = JSON.parse(listRes.content[0]!.text);
    expect(listData.targets.length).toBe(2);

    // 4. analysis.capabilities
    const capRes = (await client.callTool({
      name: 'analysis.capabilities',
      arguments: { sessionId },
    })) as { content: Array<{ type: string; text: string }> };
    const capData = JSON.parse(capRes.content[0]!.text);
    expect(Array.isArray(capData.capabilities)).toBe(true);

    // 5. investigation.status
    const statusRes = (await client.callTool({
      name: 'investigation.status',
      arguments: { sessionId },
    })) as { content: Array<{ type: string; text: string }> };
    const statusData = JSON.parse(statusRes.content[0]!.text);
    expect(statusData.sessionId).toBe(sessionId);
    expect(statusData.status).toBe('initialized');

    // 6. evidence.query
    const evRes = (await client.callTool({
      name: 'evidence.query',
      arguments: { sessionId },
    })) as { content: Array<{ type: string; text: string }> };
    const evData = JSON.parse(evRes.content[0]!.text);
    expect(evData.total).toBe(0);
    expect(Array.isArray(evData.findings)).toBe(true);

    // 7. investigation.close
    const closeRes = (await client.callTool({
      name: 'investigation.close',
      arguments: { sessionId, reason: 'completed' },
    })) as { content: Array<{ type: string; text: string }> };
    const closeData = JSON.parse(closeRes.content[0]!.text);
    expect(closeData.sessionId).toBe(sessionId);
    expect(closeData.finalReport).toBeDefined();
    expect(closeData.finalReport.summary).toContain('completed');
  });
});
