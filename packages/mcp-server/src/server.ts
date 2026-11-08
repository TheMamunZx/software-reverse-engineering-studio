#!/usr/bin/env node
/**
 * MCP Server for SRE Studio.
 *
 * Thin transport layer (stdio) that delegates all business logic to the
 * Core Engine (@sre-studio/core). No analysis logic lives here — the
 * server is purely a JSON-RPC 2.0 transport over stdio that validates
 * tool I/O against versioned JSON Schemas and forwards calls to Core.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import {
  createInvestigationOrchestrator,
  InvestigationOrchestrator,
  SessionManager,
  EvidenceEngine,
  AuthorizationManager,
  ProviderRegistry,
  createRepository,
  createSessionManager,
  createEvidenceEngine,
  createAuthorizationManager,
  createProviderRegistry,
  type InvestigationSession,
  type AnalysisTarget,
  type Finding,
  type ProviderCapability,
  type AnalysisResult,
  defaultBoundaries
} from '@sre-studio/core';
import { createRizinProvider } from '@sre-studio/provider-binary';
import { createAndroidProvider } from '@sre-studio/provider-android';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthorizationError, NotFoundError, ProviderError } from '@sre-studio/shared';
import { validateInput, validateOutput, loadValidators } from './validation/validators.js';
import { createStdioTransport } from './transport/stdio.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('mcp-server');

export interface McpServerConfig {
  sessionManager: SessionManager;
  evidenceEngine: EvidenceEngine;
  authorizationManager: AuthorizationManager;
  providerRegistry: ProviderRegistry;
  transport?: 'stdio';
}

export class McpServer {
  private server: Server;
  private orchestrator: InvestigationOrchestrator;
  private sessionManager: SessionManager;
  private evidenceEngine: EvidenceEngine;
  private authorizationManager: AuthorizationManager;
  private providerRegistry: ProviderRegistry;
  private transport: 'stdio';

  constructor(config: McpServerConfig) {
    this.sessionManager = config.sessionManager;
    this.evidenceEngine = config.evidenceEngine;
    this.authorizationManager = config.authorizationManager;
    this.providerRegistry = config.providerRegistry;
    this.transport = config.transport ?? 'stdio';

    // Core Engine owns all business logic; MCP Server is a thin transport.
    this.orchestrator = createInvestigationOrchestrator({
      sessionManager: this.sessionManager,
      providerRegistry: this.providerRegistry,
      evidenceEngine: this.evidenceEngine,
      authorizationManager: this.authorizationManager
    });

    this.server = new Server(
      { name: 'sre-studio', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools (all 8 MCP tools with versioned JSON Schemas)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'investigation.start',
          description: 'Start a new investigation session with a target',
          inputSchema: {
            type: 'object',
            required: ['target', 'scope', 'authorization'],
            properties: {
              target: {
                type: 'object',
                required: ['type', 'path'],
                properties: {
                  type: { type: 'string', enum: ['binary', 'android'] },
                  path: { type: 'string', minLength: 1 },
                  hash: { type: 'string', pattern: '^[a-f0-9]{64}$' }
                },
                additionalProperties: false
              },
              scope: { type: 'string', minLength: 1 },
              authorization: {
                type: 'object',
                required: ['type', 'description'],
                properties: {
                  type: { type: 'string', enum: ['owner', 'explicit-permission', 'public', 'authorized-testing'] },
                  description: { type: 'string', minLength: 1 },
                  documentRef: { type: 'string' }
                },
                additionalProperties: false
              },
              config: {
                type: 'object',
                properties: {
                  providers: { type: 'array', items: { type: 'string' } }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false
          }
        },
        {
          name: 'investigation.status',
          description: 'Get investigation session status and progress',
          inputSchema: {
            type: 'object',
            required: ['sessionId'],
            properties: {
              sessionId: { type: 'string', pattern: '^ses_[a-f0-9]{16}$' }
            },
            additionalProperties: false
          }
        },
        {
          name: 'investigation.close',
          description: 'Close an investigation session and generate final report',
          inputSchema: {
            type: 'object',
            required: ['sessionId', 'reason'],
            properties: {
              sessionId: { type: 'string', pattern: '^ses_[a-f0-9]{16}$' },
              reason: { type: 'string', enum: ['completed', 'cancelled', 'error'] }
            },
            additionalProperties: false
          }
        },
        {
          name: 'target.register',
          description: 'Register an additional target to an existing investigation',
          inputSchema: {
            type: 'object',
            required: ['sessionId', 'target'],
            properties: {
              sessionId: { type: 'string', pattern: '^ses_[a-f0-9]{16}$' },
              target: {
                type: 'object',
                required: ['type', 'path'],
                properties: {
                  type: { type: 'string', enum: ['binary', 'android'] },
                  path: { type: 'string', minLength: 1 },
                  hash: { type: 'string', pattern: '^[a-f0-9]{64}$' }
                },
                additionalProperties: false
              },
              authorization: {
                type: 'object',
                required: ['type', 'description'],
                properties: {
                  type: { type: 'string', enum: ['owner', 'explicit-permission', 'public', 'authorized-testing'] },
                  description: { type: 'string', minLength: 1 },
                  documentRef: { type: 'string' }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false
          }
        },
        {
          name: 'target.list',
          description: 'List targets registered to an investigation',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', pattern: '^ses_[a-f0-9]{16}$' },
              filter: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['binary', 'android'] }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false
          }
        },
        {
          name: 'analysis.run',
          description: 'Run a capability analysis on a target',
          inputSchema: {
            type: 'object',
            required: ['sessionId', 'capabilityId'],
            properties: {
              sessionId: { type: 'string', pattern: '^ses_[a-f0-9]{16}$' },
              capabilityId: { type: 'string', pattern: '^(binary|android)\\.[a-z]+$' },
              parameters: { type: 'object', additionalProperties: true }
            },
            additionalProperties: false
          }
        },
        {
          name: 'analysis.capabilities',
          description: 'List available analysis capabilities',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', pattern: '^ses_[a-f0-9]{16}$' }
            },
            additionalProperties: false
          }
        },
        {
          name: 'evidence.query',
          description: 'Query findings/evidence from an investigation',
          inputSchema: {
            type: 'object',
            required: ['sessionId'],
            properties: {
              sessionId: { type: 'string', pattern: '^ses_[a-f0-9]{16}$' },
              filter: {
                type: 'object',
                properties: {
                  category: { type: 'string', enum: ['structure', 'behavior', 'code', 'data', 'network', 'security', 'configuration', 'dependency', 'anomaly', 'other'] },
                  severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
                  confidenceMin: { type: 'number', minimum: 0, maximum: 1 },
                  capabilityId: { type: 'string', pattern: '^(binary|android)\\.[a-z]+$' },
                  targetId: { type: 'string', pattern: '^tgt_[a-f0-9]{16}$' }
                },
                additionalProperties: false
              },
              pagination: {
                type: 'object',
                properties: {
                  limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
                  offset: { type: 'integer', minimum: 0, default: 0 }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false
          }
        }
      ]
    }));

    // Handle tool calls — all business logic delegated to Core Engine
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      logger.debug({ tool: name }, 'Tool called');

      try {
        // Validate input against versioned JSON Schema
        validateInput(name, args);

        let result: unknown;

        switch (name) {
          case 'investigation.start':
            result = await this.handleInvestigationStart(args as any);
            break;
          case 'investigation.status':
            result = await this.handleInvestigationStatus(args as any);
            break;
          case 'investigation.close':
            result = await this.handleInvestigationClose(args as any);
            break;
          case 'target.register':
            result = await this.handleTargetRegister(args as any);
            break;
          case 'target.list':
            result = await this.handleTargetList(args as any);
            break;
          case 'analysis.run':
            result = await this.handleAnalysisRun(args as any);
            break;
          case 'analysis.capabilities':
            result = await this.handleAnalysisCapabilities(args as any);
            break;
          case 'evidence.query':
            result = await this.handleEvidenceQuery(args as any);
            break;
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }

        // Validate output against versioned JSON Schema
        validateOutput(name, result);

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        logger.error({ tool: name, error: error instanceof Error ? error.message : String(error) }, 'Tool failed');

        if (error instanceof McpError) throw error;

        // Map Core Engine errors to MCP errors
        if (error instanceof AuthorizationError) {
          throw new McpError(ErrorCode.InvalidParams, error.message);
        }
        if (error instanceof NotFoundError) {
          throw new McpError(ErrorCode.InvalidParams, error.message);
        }
        if (error instanceof ProviderError) {
          throw new McpError(ErrorCode.InternalError, error.message);
        }
        if (error instanceof Error) {
          throw new McpError(ErrorCode.InternalError, error.message);
        }
        throw new McpError(ErrorCode.InternalError, String(error));
      }
    });
  }

  // =====================================================================
  // Tool handlers — thin adapters delegating to Core Engine
  // =====================================================================

  private async handleInvestigationStart(args: any) {
    const session = await this.orchestrator.startInvestigation({
      projectId: 'default',
      name: `Investigation ${Date.now()}`,
      target: args.target,
      scope: args.scope,
      authorization: args.authorization,
      createdBy: 'mcp-client'
    });

    const capabilities = await this.orchestrator.getCapabilities();

    return {
      sessionId: session.id,
      targetId: session.targets[0]?.targetId ?? '',
      status: 'initialized',
      capabilities: capabilities.map(c => c.id)
    };
  }

  private async handleInvestigationStatus(args: any) {
    const session = this.orchestrator.getSession(args.sessionId);
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, `Session not found: ${args.sessionId}`);
    }

    return {
      sessionId: session.id,
      status: session.status,
      progress: session.progress,
      findingsCount: session.progress.findingsCount
    };
  }

  private async handleInvestigationClose(args: any) {
    const session = this.orchestrator.getSession(args.sessionId);
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, `Session not found: ${args.sessionId}`);
    }

    const closed = await this.orchestrator.closeInvestigation(args.sessionId, args.reason);
    if (!closed) {
      throw new McpError(ErrorCode.InternalError, 'Failed to close session');
    }

    // Generate final report using Core Evidence Engine
    const stats = this.evidenceEngine.getSessionStatistics(args.sessionId);
    const findingsResult = this.evidenceEngine.queryFindings({
      sessionId: args.sessionId,
      limit: 1000
    });

    return {
      sessionId: args.sessionId,
      finalReport: {
        summary: `Investigation ${args.reason}`,
        statistics: {
          byCategory: stats.findingsByCategory,
          bySeverity: stats.findingsBySeverity,
          avgConfidence: stats.avgConfidence
        },
        findings: findingsResult.findings.map(f => f.id)
      }
    };
  }

  private async handleTargetRegister(args: any) {
    const session = this.orchestrator.getSession(args.sessionId);
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, `Session not found: ${args.sessionId}`);
    }

    const authRecord = {
      type: args.authorization?.type ?? session.authorization.type,
      description: args.authorization?.description ?? session.authorization.description,
      scope: args.authorization?.scope ?? [args.authorization?.description ?? session.authorization.description],
      limitations: args.authorization?.limitations ?? [],
      documentReference: args.authorization?.documentRef ?? session.authorization.documentReference,
      verified: false
    };

    const target = this.sessionManager.registerTarget(args.sessionId, {
      type: args.target.type,
      path: args.target.path,
      metadata: {},
      hashes: { sha256: args.target.hash ?? '' },
      authorization: authRecord,
      role: (args.target.role === 'secondary' || args.target.role === 'reference') ? args.target.role : 'primary'
    });

    // Enforce authorization for target registration (target now exists in repo)
    await this.authorizationManager.authorize({
      sessionId: args.sessionId,
      targetId: target.id,
      capabilityId: '',
      operation: 'target-register'
    });

    return {
      targetId: target.id,
      sessionId: args.sessionId
    };
  }

  private async handleTargetList(args: any) {
    const session = this.orchestrator.getSession(args.sessionId);
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, `Session not found: ${args.sessionId}`);
    }

    const targets = this.sessionManager.getTargets(args.sessionId);

    return {
      targets: targets.map(t => ({
        targetId: t.id,
        type: t.type,
        path: t.path,
        role: t.role,
        addedAt: t.addedAt
      }))
    };
  }

  private async handleAnalysisRun(args: any) {
    const session = this.orchestrator.getSession(args.sessionId);
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, `Session not found: ${args.sessionId}`);
    }

    const targetId = args.targetId ?? session.targets[0]?.targetId;
    if (!targetId) {
      throw new McpError(ErrorCode.InvalidParams, 'No target specified and no default target in session');
    }

    // Authorization enforced at the Core analysis entry point
    const result = await this.orchestrator.runAnalysis({
      sessionId: args.sessionId,
      capabilityId: args.capabilityId,
      parameters: args.parameters ?? {},
      targetId
    });

    return {
      findings: result.findings.map(f => ({
        id: f.id,
        title: f.title,
        observation: f.observation,
        inference: f.inference,
        category: f.category,
        severity: f.severity,
        confidence: f.confidence,
        evidence: f.evidence,
        provenance: f.provenance
      })),
      summary: result.summary,
      statistics: result.statistics
    };
  }

  private async handleAnalysisCapabilities(args: any) {
    const capabilities = await this.orchestrator.getCapabilities(args.sessionId);

    return {
      capabilities: capabilities.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        category: c.category,
        providerId: c.id.split('.')[0],
        inputSchema: c.inputSchema,
        outputSchema: c.outputSchema
      }))
    };
  }

  private async handleEvidenceQuery(args: any) {
    const session = this.orchestrator.getSession(args.sessionId);
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, `Session not found: ${args.sessionId}`);
    }

    const result = this.evidenceEngine.queryFindings({
      sessionId: args.sessionId,
      category: args.filter?.category,
      severity: args.filter?.severity,
      confidenceMin: args.filter?.confidenceMin,
      capabilityId: args.filter?.capabilityId,
      targetId: args.filter?.targetId,
      limit: args.pagination?.limit ?? 50,
      offset: args.pagination?.offset ?? 0
    });

    return {
      findings: result.findings.map(f => ({
        id: f.id,
        title: f.title,
        observation: f.observation,
        inference: f.inference,
        category: f.category,
        severity: f.severity,
        confidence: f.confidence,
        evidence: f.evidence,
        provenance: f.provenance,
        createdAt: f.createdAt
      })),
      total: result.total,
      hasMore: result.hasMore
    };
  }

  // =====================================================================
  // Transport lifecycle
  // =====================================================================

  async start(customTransport?: any): Promise<void> {
    await loadValidators();

    const transport = customTransport ?? new StdioServerTransport();
    await this.server.connect(transport);

    logger.info('MCP Server started on stdio');
  }

  async stop(): Promise<void> {
    await this.server.close();
    logger.info('MCP Server stopped');
  }
}

export function createMcpServer(config: McpServerConfig): McpServer {
  return new McpServer(config);
}

/**
 * CLI runner for the standalone MCP server process (`sre-studio-mcp`).
 */
export async function runMcpServerCli(): Promise<void> {
  const workspaceDir = process.env['SRE_STUDIO_WORKSPACE'] || process.cwd();
  const sreStudioDir = path.join(workspaceDir, '.sre-studio');
  if (!fs.existsSync(sreStudioDir)) {
    fs.mkdirSync(sreStudioDir, { recursive: true });
  }
  const dbPath = path.join(sreStudioDir, 'investigation.db');

  const repository = createRepository({ dbPath });
  const evidenceEngine = createEvidenceEngine({ repository });
  const sessionManager = createSessionManager({ repository, evidenceEngine });
  const authorizationManager = createAuthorizationManager(defaultBoundaries, sessionManager, repository);
  const providerRegistry = createProviderRegistry();
  providerRegistry.register(createRizinProvider());
  providerRegistry.register(createAndroidProvider());

  const server = new McpServer({
    sessionManager,
    evidenceEngine,
    authorizationManager,
    providerRegistry,
  });

  const cleanup = async () => {
    try {
      await server.stop();
    } catch {
      // Ignore
    }
    try {
      repository.close();
    } catch {
      // Ignore
    }
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  await server.start();
}

// Auto-run when invoked as the main script
const currentFile = fileURLToPath(import.meta.url);
const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedScript && (
  invokedScript === currentFile ||
  invokedScript.endsWith('server.js') ||
  invokedScript.endsWith('server.ts') ||
  invokedScript.includes('sre-studio-mcp')
)) {
  runMcpServerCli().catch((err) => {
    logger.error({ err }, 'Fatal error starting MCP Server');
    process.exit(1);
  });
}

