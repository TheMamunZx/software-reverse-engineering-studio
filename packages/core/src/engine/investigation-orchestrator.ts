import { SessionManager } from './session-manager.js';
import { ProviderRegistry } from './capability-registry.js';
import { EvidenceEngine } from '../evidence/evidence-engine.js';
import { AuthorizationManager } from '../security/authorization.js';
import type { CapabilityProvider, AnalysisRequest, AnalysisResult } from '../types/provider.js';
import type { InvestigationSession, SessionStatus } from '../types/investigation.js';
import type { AuthorizationType } from '../types/investigation.js';
import { AuthorizationError, NotFoundError } from '@sre-studio/shared';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('investigation-orchestrator');

export interface InvestigationOrchestratorConfig {
  sessionManager: SessionManager;
  providerRegistry: ProviderRegistry;
  evidenceEngine: EvidenceEngine;
  authorizationManager: AuthorizationManager;
}

export class InvestigationOrchestrator {
  private sessionManager: SessionManager;
  private providerRegistry: ProviderRegistry;
  private evidenceEngine: EvidenceEngine;
  private authorizationManager: AuthorizationManager;

  constructor(config: InvestigationOrchestratorConfig) {
    this.sessionManager = config.sessionManager;
    this.providerRegistry = config.providerRegistry;
    this.evidenceEngine = config.evidenceEngine;
    this.authorizationManager = config.authorizationManager;
  }

  async startInvestigation(input: {
    projectId: string;
    name: string;
    description?: string;
    target: { type: 'binary' | 'android'; path: string; hash?: string };
    scope: string;
    authorization: { type: AuthorizationType; description: string; documentRef?: string };
    createdBy: string;
  }): Promise<InvestigationSession> {
    const authRecord = {
      type: input.authorization.type,
      description: input.authorization.description,
      scope: [input.scope],
      limitations: [],
      documentReference: input.authorization.documentRef,
      verified: false
    };

    // Create session first (without target)
    const session = await this.sessionManager.createSession({
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      authorization: authRecord,
      createdBy: input.createdBy
    });

    try {
      // Register the initial target
      const target = this.sessionManager.registerTarget(session.id, {
        type: input.target.type,
        path: input.target.path,
        metadata: {},
        hashes: { sha256: input.target.hash ?? '' },
        authorization: authRecord,
        role: 'primary'
      });

      // Enforce authorization for target registration (target now exists so
      // boundary rules can inspect type/path/hash).
      await this.authorizationManager.authorize({
        sessionId: session.id,
        targetId: target.id,
        capabilityId: '',
        operation: 'target-register'
      });

      // Re-fetch the session so the returned object includes the registered target.
      const sessionWithTarget = this.sessionManager.getSession(session.id)!;

      logger.info({
        sessionId: session.id,
        targetId: target.id,
        targetType: input.target.type
      }, 'Investigation started');

      return sessionWithTarget;
    } catch (error) {
      // If authorization or registration fails, clean up the orphaned session.
      try {
        this.sessionManager.closeSession(session.id, 'error');
      } catch {
        // Best-effort cleanup
      }
      throw error;
    }
  }

  async runAnalysis(input: {
    sessionId: string;
    capabilityId: string;
    parameters: Record<string, unknown>;
    targetId?: string;
  }): Promise<AnalysisResult> {
    const session = this.sessionManager.getSession(input.sessionId);
    if (!session) {
      throw new NotFoundError('Session', input.sessionId);
    }

    // Get target
    const targetId = input.targetId ?? session.targets[0]?.targetId;
    if (!targetId) {
      throw new NotFoundError('Target', 'none registered in session');
    }

    // Verify target exists
    this.sessionManager.getTargetOrThrow(targetId);

    // Enforce authorization at the analysis entry point
    await this.authorizationManager.authorize({
      sessionId: input.sessionId,
      targetId,
      capabilityId: input.capabilityId,
      operation: 'analysis'
    });

    this.authorizationManager.beginAnalysis();
    try {
      // Resolve provider
      const provider = this.providerRegistry.resolveBest(input.capabilityId);
      if (!provider) {
        throw new Error(`No provider found for capability: ${input.capabilityId}`);
      }

      // Run analysis
      const request: AnalysisRequest = {
        sessionId: input.sessionId,
        targetId,
        capabilityId: input.capabilityId,
        parameters: input.parameters
      };

      const result = await provider.analyze(request);

      // Persist findings via evidence engine.
      // Before creating findings we ensure that each finding's
      // reproducibility.environmentId references a row that actually exists in
      // the environments table.  The orchestrator always stamps a real
      // environment record here; providers must NOT invent their own
      // environment IDs (they may omit environmentId entirely).
      if (result.findings.length > 0) {
        // Capture the environment for this analysis run once and reuse it for
        // every finding produced in this result.  getOrCreateEnvironment is
        // idempotent for (sessionId, targetHash) pairs.
        const target = this.sessionManager.getTargetOrThrow(targetId);
        const targetHash = target.hashes?.sha256 ?? '';
        const env = this.sessionManager.getOrCreateEnvironment(input.sessionId, targetHash);

        const persisted = this.evidenceEngine.createFindings(
          result.findings.map(f => ({
            ...f,
            createdBy: 'orchestrator',
            // Always use the persisted environment row ID regardless of what
            // the provider returned.  This guarantees the FK constraint is
            // satisfied and the environment is normalized/shared across findings.
            reproducibility: {
              ...f.reproducibility,
              environmentId: env.id
            }
          }))
        );
        result.findings = persisted;
      }

      // Update session progress
      this.sessionManager.updateProgress(input.sessionId, {
        completedSteps: session.progress.completedSteps + 1,
        findingsCount: session.progress.findingsCount + result.findings.length
      });

      logger.info({ sessionId: input.sessionId, capabilityId: input.capabilityId, findingsCount: result.findings.length }, 'Analysis completed');
      return result;
    } finally {
      this.authorizationManager.endAnalysis();
    }
  }

  async getCapabilities(sessionId?: string) {
    return this.providerRegistry.listCapabilities();
  }

  async closeInvestigation(sessionId: string, reason: 'completed' | 'cancelled' | 'error' = 'completed') {
    this.sessionManager.getSessionOrThrow(sessionId);
    const session = this.sessionManager.closeSession(sessionId, reason);
    logger.info({ sessionId, reason }, 'Investigation closed');
    return session;
  }

  getSession(sessionId: string): InvestigationSession | null {
    return this.sessionManager.getSession(sessionId);
  }

  getSessionOrThrow(sessionId: string): InvestigationSession {
    return this.sessionManager.getSessionOrThrow(sessionId);
  }

  listSessions(projectId?: string): InvestigationSession[] {
    return this.sessionManager.listSessions(projectId);
  }
}

export function createInvestigationOrchestrator(config: InvestigationOrchestratorConfig): InvestigationOrchestrator {
  return new InvestigationOrchestrator(config);
}
