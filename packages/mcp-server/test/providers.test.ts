import { describe, expect, it } from 'vitest';
import { createSessionManager, createRepository, createEvidenceEngine, createAuthorizationManager, createProviderRegistry, createInvestigationOrchestrator, defaultBoundaries, type AuthorizationBoundary, type ProviderCapability } from '@sre-studio/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function createStack(boundaries: AuthorizationBoundary, label: string) {
  const directory = mkdtempSync(path.join(tmpdir(), `sre-studio-mcp-prov-${label}-`));
  const dbPath = path.join(directory, 'investigation.db');
  const repository = createRepository({ dbPath });
  const sessionManager = createSessionManager({ repository, evidenceEngine: createEvidenceEngine({ repository }) });
  const evidenceEngine = createEvidenceEngine({ repository });
  const authorizationManager = createAuthorizationManager(boundaries, sessionManager, repository);
  const providerRegistry = createProviderRegistry();
  const orchestrator = createInvestigationOrchestrator({
    sessionManager,
    providerRegistry,
    evidenceEngine,
    authorizationManager
  });

  return {
    directory, dbPath, repository, sessionManager, evidenceEngine, authorizationManager, providerRegistry, orchestrator,
    cleanup: () => { repository.close(); rmSync(directory, { recursive: true, force: true }); }
  };
}

class MockProvider {
  readonly id = 'prv_test0123456789';
  readonly name = 'Test Provider';
  readonly version = '0.1.0';
  readonly description = 'Test provider for MCP tests';
  readonly capabilities: ReadonlyArray<ProviderCapability> = [{
    id: 'test.info',
    name: 'Test Info',
    description: 'Returns test findings',
    category: 'static-analysis',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' }
  }];
  readonly requiredTools = [];
  async initialize() { return { success: true, availableCapabilities: ['test.info'] }; }
  async validateEnvironment() { return { valid: true, availableTools: [], missingTools: [], warnings: [] }; }
  async analyze() {
    return {
      findings: [{
        id: '', sessionId: '', targetId: '', providerId: this.id, capabilityId: 'test.info',
        category: 'structure', severity: 'info', title: 'Test finding', observation: 'Test observation',
        evidence: [], confidence: { level: 'high', value: 0.95, justification: 'Test', factors: [] },
        limitations: [], unknowns: [],
        provenance: { derivedFrom: [], tool: 'test-provider', command: 'test', parameters: {}, duration: 5, toolVersion: '1.0.0' },
        reproducibility: { reproducible: true, environmentId: undefined, steps: [], knownVariations: [] },
        tags: [], createdBy: 'test-provider', version: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }],
      summary: 'Test analysis complete',
      statistics: { findingsByCategory: { structure: 1 }, findingsBySeverity: { info: 1 }, evidenceCount: 0, avgConfidence: 0.95 },
      duration: 5, toolOutputs: [], warnings: [], errors: []
    };
  }
  async shutdown() {}
}

describe('MCP Server — Provider integration', () => {
  it('denies analysis when no providers are registered', async () => {
    const stack = createStack(defaultBoundaries, 'noproviders');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test', name: 'No Providers',
        authorization: { type: 'owner', description: 'Test', scope: [], limitations: [], verified: true },
        createdBy: 'mcp-test'
      });
      // Update boundaries to allow the target (otherwise authorize() denies before we even get to provider check)
      stack.authorizationManager.updateBoundaries({
        ...defaultBoundaries,
        allowedTargets: [{ type: 'binary', pathPattern: 'C:/targets/.*' }],
        allowedCapabilities: [{ capability: 'test.info' }]
      });
      const target = stack.repository.registerTarget(session.id, {
        type: 'binary', path: 'C:/targets/sample.exe', metadata: {}, hashes: { sha256: 'a'.repeat(64) },
        authorization: { type: 'owner', description: 'Test', scope: [], limitations: [], verified: true },
        role: 'primary'
      });
      await stack.authorizationManager.authorize({
        sessionId: session.id, targetId: target.id, capabilityId: 'test.info', operation: 'analysis'
      });
      // No providers registered - runAnalysis should fail
      await expect(
        stack.orchestrator.runAnalysis({ sessionId: session.id, capabilityId: 'test.info', parameters: {}, targetId: target.id })
      ).rejects.toThrow();
    } finally { stack.cleanup(); }
  });

  it('provider registry can register and list providers', async () => {
    const stack = createStack(defaultBoundaries, 'registry');
    try {
      const provider = new MockProvider();
      stack.providerRegistry.register(provider);
      const validation = await stack.providerRegistry.validateAll();
      expect(validation.providers).toHaveLength(1);
      expect(validation.providers[0].providerId).toBe('prv_test0123456789');
      expect(validation.providers[0].valid).toBe(true);
      const capabilities = stack.providerRegistry.listCapabilities();
      expect(capabilities).toHaveLength(1);
      expect(capabilities[0].id).toBe('test.info');
      const resolved = stack.providerRegistry.resolveBest('test.info');
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe('prv_test0123456789');
    } finally { stack.cleanup(); }
  });

  it('evidence query returns findings with proper structure', async () => {
    const stack = createStack(defaultBoundaries, 'evidence');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test', name: 'Evidence Test',
        authorization: { type: 'owner', description: 'Test', scope: [], limitations: [], verified: true },
        createdBy: 'mcp-test'
      });
      const target = stack.repository.registerTarget(session.id, {
        type: 'binary', path: 'C:/targets/sample.exe', metadata: {}, hashes: { sha256: 'f'.repeat(64) },
        authorization: { type: 'owner', description: 'Test', scope: [], limitations: [], verified: true },
        role: 'primary'
      });
      const finding = stack.evidenceEngine.createFinding({
        sessionId: session.id, targetId: target.id,
        providerId: 'prv_test0123456789', capabilityId: 'binary.info', category: 'structure', severity: 'info',
        title: 'Test finding', observation: 'Test observation', evidence: [],
        confidence: { level: 'high', value: 0.95, justification: 'Test', factors: [] },
        limitations: [], unknowns: [],
        provenance: { derivedFrom: [], tool: 'test-provider', command: 'test --scan', parameters: {}, duration: 10, toolVersion: '1.0.0' },
        reproducibility: { reproducible: true, environmentId: undefined, steps: [], knownVariations: [] },
        tags: [], createdBy: 'mcp-test'
      });
      const result = stack.evidenceEngine.queryFindings({ sessionId: session.id });
      expect(result.total).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].id).toBe(finding.id);
      expect(result.findings[0].title).toBe('Test finding');
      expect(result.findings[0].confidence.level).toBe('high');
      expect(result.findings[0].provenance.tool).toBe('test-provider');
      const filtered = stack.evidenceEngine.queryFindings({ sessionId: session.id, category: 'structure' });
      expect(filtered.total).toBe(1);
      const empty = stack.evidenceEngine.queryFindings({ sessionId: session.id, category: 'code' });
      expect(empty.total).toBe(0);
    } finally { stack.cleanup(); }
  });

  it('getSessionStatistics returns aggregated stats', async () => {
    const stack = createStack(defaultBoundaries, 'stats');
    try {
      const session = await stack.sessionManager.createSession({
        projectId: 'proj_test', name: 'Stats Test',
        authorization: { type: 'owner', description: 'Test', scope: [], limitations: [], verified: true },
        createdBy: 'mcp-test'
      });
      const target = stack.repository.registerTarget(session.id, {
        type: 'binary', path: 'C:/targets/sample.exe', metadata: {}, hashes: { sha256: 'g'.repeat(64) },
        authorization: { type: 'owner', description: 'Test', scope: [], limitations: [], verified: true },
        role: 'primary'
      });
      stack.evidenceEngine.createFinding({
        sessionId: session.id, targetId: target.id, providerId: 'prv_test0123456789',
        capabilityId: 'binary.info', category: 'structure', severity: 'info', title: 'Info finding', observation: 'Info',
        evidence: [], confidence: { level: 'high', value: 0.9, justification: 'Test', factors: [] },
        limitations: [], unknowns: [],
        provenance: { derivedFrom: [], tool: 'test', command: 'test', parameters: {}, duration: 1, toolVersion: '1.0' },
        reproducibility: { reproducible: true, environmentId: undefined, steps: [], knownVariations: [] },
        tags: [], createdBy: 'mcp-test'
      });
      stack.evidenceEngine.createFinding({
        sessionId: session.id, targetId: target.id, providerId: 'prv_test0123456789',
        capabilityId: 'binary.strings', category: 'data', severity: 'high', title: 'High finding', observation: 'High',
        evidence: [], confidence: { level: 'medium', value: 0.7, justification: 'Test', factors: [] },
        limitations: [], unknowns: [],
        provenance: { derivedFrom: [], tool: 'test', command: 'test', parameters: {}, duration: 1, toolVersion: '1.0' },
        reproducibility: { reproducible: true, environmentId: undefined, steps: [], knownVariations: [] },
        tags: [], createdBy: 'mcp-test'
      });
      const stats = stack.evidenceEngine.getSessionStatistics(session.id);
      expect(stats.findingsByCategory).toMatchObject({ structure: 1, data: 1 });
      expect(stats.findingsBySeverity).toMatchObject({ info: 1, high: 1 });
      expect(stats.avgConfidence).toBe(0.8);
    } finally { stack.cleanup(); }
  });
});