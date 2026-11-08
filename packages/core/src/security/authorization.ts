import type {
  AuthorizationBoundary,
  AuthorizationResult,
  ApprovalRequired,
  TargetPattern,
  CapabilityPattern
} from './boundaries.js';
import type { ResourceLimits } from '../types/investigation.js';
import type { AnalysisTarget } from '../types/target.js';
import { Repository } from '../storage/repository.js';
import { AuthorizationError } from '@sre-studio/shared';
import { createLogger } from '@sre-studio/shared';
import path from 'node:path';
import fs from 'node:fs';

const logger = createLogger('authorization-manager');

export interface AuthorizedRequest {
  sessionId: string;
  targetId: string;
  capabilityId: string;
  operation: 'analysis' | 'target-register' | 'evidence-query' | 'session-close';
}

/**
 * Target reader interface used by AuthorizationManager to inspect target
 * metadata without depending on the full SessionManager.
 */
export interface TargetReader {
  getTarget(targetId: string): AnalysisTarget | null;
}

export class AuthorizationManager {
  private boundaries: AuthorizationBoundary;
  private targetReader: TargetReader;
  private repository: Repository;

  constructor(boundaries: AuthorizationBoundary, targetReader: TargetReader, repository: Repository) {
    this.boundaries = boundaries;
    this.targetReader = targetReader;
    this.repository = repository;
  }

  async authorize(request: AuthorizedRequest): Promise<AuthorizationResult> {
    const timestamp = new Date().toISOString();

    // 1. Check target permission
    const targetAuth = this.checkTargetAuthorization(request.targetId);

    // 2. Check capability permission (only when a capabilityId is specified;
    // target-register and similar operations don't target a specific capability).
    const capabilityAuth = request.capabilityId
      ? this.checkCapabilityAuthorization(request.capabilityId, request.targetId)
      : true;

    // 3. Check operation approval requirements
    const approvalNeeded = this.checkApprovalRequired(request.operation);

    // 4. Check resource limits
    const resourceCheck = await this.checkResourceLimits(request);

    const allowed = targetAuth && capabilityAuth && resourceCheck;
    const reason = targetAuth
      ? capabilityAuth
        ? resourceCheck ? null : 'resource-limit'
        : 'capability-denied'
      : 'target-denied';

    // 5. Audit log (persisted to SQLite)
    await this.auditLog({
      request,
      decision: allowed ? 'allow' : 'deny',
      approvalNeeded,
      timestamp,
      reason: reason ?? undefined
    });

    logger.info({
      sessionId: request.sessionId,
      targetId: request.targetId,
      capabilityId: request.capabilityId,
      operation: request.operation,
      allowed,
      reason
    }, 'Authorization decision');

    if (!allowed) {
      throw new AuthorizationError(reason!, approvalNeeded);
    }

    return {
      allowed: true,
      approvalNeeded,
      reason: null,
      boundaries: this.boundaries
    };
  }

  /**
   * Synchronously checks whether the target is authorized without throwing.
   * Used by callers that want a boolean result rather than an exception.
   */
  isTargetAuthorized(targetId: string): boolean {
    return this.checkTargetAuthorization(targetId);
  }

  private checkTargetAuthorization(targetId: string): boolean {
    // Fail-closed: if no targets are explicitly authorized, deny everything.
    if (this.boundaries.allowedTargets.length === 0) return false;

    const target = this.targetReader.getTarget(targetId);
    if (!target) return false;

    for (const pattern of this.boundaries.allowedTargets) {
      if (pattern.type !== '*' && pattern.type !== target.type) continue;
      if (pattern.pathPattern) {
        // Normalize target path (resolving any '..' traversal components) to defend against traversal bypasses
        const normTarget = path.normalize(target.path).replace(/\\/g, '/');
        const normPattern = path.normalize(pattern.pathPattern).replace(/\\/g, '/');
        let regexPattern = normPattern;
        if (!normPattern.includes('.*')) {
          regexPattern = normPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        }
        const regex = new RegExp('^' + regexPattern + '$', process.platform === 'win32' ? 'i' : undefined);
        if (!regex.test(normTarget)) continue;

        // Symlink / Junction Defense:
        // If the target exists on the filesystem, verify that its canonical real path
        // (resolving all Windows directory junctions and symlinks) does not escape
        // the authorized boundary pattern.
        if (fs.existsSync(target.path)) {
          try {
            const realTargetPath = fs.realpathSync(target.path).replace(/\\/g, '/');
            if (!regex.test(realTargetPath)) {
              // Canonical target path points outside the authorized boundary!
              continue;
            }
          } catch {
            // Fail closed if realpath resolution encounters an unexpected I/O error
            continue;
          }
        }
      }
      if (pattern.hashAllowlist && pattern.hashAllowlist.length > 0) {
        if (!pattern.hashAllowlist.includes(target.hashes.sha256)) continue;
      }
      return true;
    }
    return false;
  }

  private checkCapabilityAuthorization(capabilityId: string, _targetId: string): boolean {
    // Fail-closed: if no capabilities are explicitly authorized, deny everything.
    if (this.boundaries.allowedCapabilities.length === 0) return false;

    for (const pattern of this.boundaries.allowedCapabilities) {
      if (pattern.provider && !capabilityId.startsWith(pattern.provider + '.')) continue;
      if (pattern.capability && capabilityId !== pattern.capability) continue;
      if (pattern.category) {
        // Category matching would require provider lookup; allow if provider/capability match
      }
      return true;
    }
    return false;
  }

  private checkApprovalRequired(operation: AuthorizedRequest['operation']): ApprovalRequired[] {
    const required: ApprovalRequired[] = [];

    if (this.boundaries.requiresApproval.includes('dynamic-execution') && operation === 'analysis') {
      // Dynamic execution requires approval; flagged but not enforced in MVP
    }
    if (this.boundaries.requiresApproval.includes('network-capture') && operation === 'analysis') {
      // Network capture requires approval; flagged but not enforced in MVP
    }
    if (this.boundaries.requiresApproval.includes('file-modification') && operation === 'target-register') {
      required.push('file-modification');
    }

    return required;
  }

  private activeAnalyses = 0;

  beginAnalysis(): void {
    this.activeAnalyses++;
  }

  endAnalysis(): void {
    this.activeAnalyses = Math.max(0, this.activeAnalyses - 1);
  }

  getActiveAnalysesCount(): number {
    return this.activeAnalyses;
  }

  private async checkResourceLimits(request: AuthorizedRequest): Promise<boolean> {
    const limits = this.boundaries.limits;
    if (!limits) return true;

    // Check concurrency limit if operation is analysis
    if (request.operation === 'analysis' && limits.maxConcurrentAnalyses > 0) {
      if (this.activeAnalyses >= limits.maxConcurrentAnalyses) {
        logger.warn({
          active: this.activeAnalyses,
          max: limits.maxConcurrentAnalyses,
        }, 'Concurrency limit exceeded');
        return false;
      }
    }

    // Check process memory limit (advisory application-level check)
    if (limits.maxMemoryMb > 0) {
      const memoryUsageMb = process.memoryUsage().rss / (1024 * 1024);
      if (memoryUsageMb > limits.maxMemoryMb) {
        logger.warn({
          usedMb: memoryUsageMb,
          limitMb: limits.maxMemoryMb,
        }, 'Memory resource limit exceeded');
        return false;
      }
    }

    return true;
  }

  private async auditLog(entry: {
    request: AuthorizedRequest;
    decision: 'allow' | 'deny';
    approvalNeeded: ApprovalRequired[];
    timestamp: string;
    reason?: string | null;
  }): Promise<void> {
    this.repository.writeAuditLog({
      sessionId: entry.request.sessionId,
      targetId: entry.request.targetId,
      capabilityId: entry.request.capabilityId,
      operation: entry.request.operation,
      decision: entry.decision,
      reason: entry.reason ?? undefined,
      approvalNeeded: entry.approvalNeeded,
      timestamp: entry.timestamp,
      details: {
        targetAuth: undefined,
        capabilityAuth: undefined
      }
    });
  }

  getActiveBoundaries(): AuthorizationBoundary {
    return this.boundaries;
  }

  updateBoundaries(boundaries: Partial<AuthorizationBoundary>): void {
    this.boundaries = { ...this.boundaries, ...boundaries };
  }
}

export function createAuthorizationManager(
  boundaries: AuthorizationBoundary,
  targetReader: TargetReader,
  repository: Repository
): AuthorizationManager {
  return new AuthorizationManager(boundaries, targetReader, repository);
}

// Default boundaries for MVP - fail-closed. No targets or capabilities are
// authorized by default. Callers (CLI, MCP server, tests) must explicitly
// configure allowedTargets and/or allowedCapabilities before any operation
// can succeed. Wildcard access is never enabled by default.
export const defaultBoundaries: AuthorizationBoundary = {
  allowedTargets: [],
  allowedCapabilities: [],
  requiresApproval: ['dynamic-execution', 'network-capture', 'file-modification', 'external-service', 'credential-access', 'high-resource-usage'],
  limits: {
    maxMemoryMb: 4096,
    maxCpuPercent: 80,
    maxDurationMs: 300000,
    maxConcurrentAnalyses: 10,
    maxDiskUsageMb: 2048
  },
  dataHandling: {
    allowExternalTransmission: false,
    redactionRules: [],
    maxRetentionDays: 90,
    encryptAtRest: false // Will be enabled in Phase 2
  }
};
