import type {
  InvestigationSession,
  SessionStatus,
  SessionConfig,
  SessionProgress,
  AuthorizationRecord,
  TargetReference,
  AuthorizationType,
  TargetRole,
  ResourceLimits
} from '../types/investigation.js';
import type { AnalysisTarget } from '../types/target.js';
import { Repository } from '../storage/repository.js';
import { EvidenceEngine } from '../evidence/evidence-engine.js';
import { generateId } from '@sre-studio/shared';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('session-manager');

export interface SessionManagerConfig {
  repository: Repository;
  evidenceEngine: EvidenceEngine;
  defaultResourceLimits?: ResourceLimits;
}

export class SessionManager {
  private repository: Repository;
  private evidenceEngine: EvidenceEngine;
  private defaultResourceLimits: ResourceLimits;

  constructor(config: SessionManagerConfig) {
    this.repository = config.repository;
    this.evidenceEngine = config.evidenceEngine;
    this.defaultResourceLimits = config.defaultResourceLimits ?? {
      maxMemoryMb: 4096,
      maxCpuPercent: 80,
      maxDurationMs: 300000,
      maxConcurrentAnalyses: 10,
      maxDiskUsageMb: 2048
    };
  }

  async createSession(input: {
    projectId: string;
    name: string;
    description?: string;
    initialTarget?: Omit<AnalysisTarget, 'id' | 'sessionId' | 'addedAt'>;
    authorization: AuthorizationRecord;
    config?: SessionConfig;
    createdBy: string;
    tags?: string[];
  }): Promise<InvestigationSession> {
    const sessionId = generateId('session');
    const now = new Date().toISOString();

    const progress: SessionProgress = {
      totalSteps: 0,
      completedSteps: 0,
      findingsCount: 0,
      evidenceCount: 0,
      errors: []
    };

    const sessionConfig: SessionConfig = {
      providers: input.config?.providers,
      resourceLimits: { ...this.defaultResourceLimits, ...input.config?.resourceLimits },
      progress
    };

    const session = this.repository.createSession({
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      targets: [],
      authorization: input.authorization,
      status: 'initialized',
      progress,
      config: sessionConfig,
      createdBy: input.createdBy,
      tags: input.tags ?? []
    });

    if (input.initialTarget) {
      const target = this.repository.registerTarget(session.id, input.initialTarget);
      // Update session with target reference
      this.repository.updateSession(session.id, {
        targets: [{ targetId: target.id, role: target.role, addedAt: target.addedAt }]
      });
      // Re-fetch so the returned session reflects the registered target.
      const updated = this.repository.getSession(session.id);
      if (updated) {
        return updated;
      }
    }

    logger.info({ sessionId: session.id }, 'Session created via SessionManager');
    return session;
  }

  getSession(id: string): InvestigationSession | null {
    return this.repository.getSession(id);
  }

  getSessionOrThrow(id: string): InvestigationSession {
    return this.repository.getSessionOrThrow(id);
  }

  updateSession(id: string, updates: Partial<InvestigationSession>): InvestigationSession | null {
    return this.repository.updateSession(id, updates);
  }

  updateSessionStatus(id: string, status: SessionStatus): InvestigationSession | null {
    return this.repository.updateSession(id, { status });
  }

  updateProgress(id: string, progress: Partial<SessionProgress>): InvestigationSession | null {
    const session = this.repository.getSession(id);
    if (!session) return null;
    return this.repository.updateSession(id, {
      progress: { ...session.progress, ...progress }
    });
  }

  closeSession(id: string, reason: 'completed' | 'cancelled' | 'error' = 'completed'): InvestigationSession | null {
    const status = reason === 'completed' ? 'completed' : reason === 'cancelled' ? 'archived' : 'failed';
    return this.repository.updateSession(id, { status });
  }

  listSessions(projectId?: string): InvestigationSession[] {
    return this.repository.listSessions(projectId);
  }

  registerTarget(sessionId: string, target: Omit<AnalysisTarget, 'id' | 'sessionId' | 'addedAt'>): AnalysisTarget {
    return this.repository.registerTarget(sessionId, target);
  }

  getTargets(sessionId: string): AnalysisTarget[] {
    return this.repository.getTargetsBySession(sessionId);
  }

  getTarget(targetId: string): AnalysisTarget | null {
    return this.repository.getTarget(targetId);
  }

  getTargetOrThrow(targetId: string): AnalysisTarget {
    return this.repository.getTargetOrThrow(targetId);
  }

  /**
   * Returns an existing environment snapshot for (sessionId, targetHash), or
   * creates and persists one if none exists.  The returned snapshot is always
   * stored in SQLite before this call returns, so its `id` is safe to use as
   * a foreign-key value in `findings.environment_id`.
   */
  getOrCreateEnvironment(sessionId: string, targetHash: string) {
    return this.repository.getOrCreateEnvironment(sessionId, targetHash);
  }
}

export function createSessionManager(config: SessionManagerConfig): SessionManager {
  return new SessionManager(config);
}
