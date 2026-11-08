import { SqliteAdapter } from './sqlite-adapter.js';
import { migrate } from './migrations/migrator.js';
import type {
  InvestigationSession,
  TargetReference,
  AuthorizationRecord,
  SessionProgress,
  SessionConfig,
  SessionStatus,
  TargetRole,
  AuthorizationType
} from '../types/investigation.js';
import type {
  AnalysisTarget,
  TargetHashes,
  TargetAuthorization
} from '../types/target.js';
import type {
  Finding,
  EvidenceReference,
  ConfidenceScore,
  ProvenanceInfo,
  ReproducibilityInfo,
  EnvironmentSnapshot,
  FindingCategory,
  FindingSeverity
} from '../types/evidence.js';
import { generateId, NotFoundError } from '@sre-studio/shared';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('repository');

export interface RepositoryConfig {
  dbPath: string;
}

export interface AuditLogEntry {
  sessionId?: string;
  targetId?: string;
  capabilityId?: string;
  operation: string;
  decision: 'allow' | 'deny';
  reason?: string;
  approvalNeeded?: string[];
  timestamp: string;
  details?: Record<string, unknown>;
}

export class Repository {
  private adapter: SqliteAdapter;

  constructor(config: RepositoryConfig) {
    this.adapter = new SqliteAdapter({ path: config.dbPath, walMode: true });
    // better-sqlite3 is synchronous: migrations run to completion before this returns.
    migrate(this.adapter);
  }

  getAdapter(): SqliteAdapter {
    return this.adapter;
  }

  close(): void {
    this.adapter.close();
  }

  // ========== Session Operations ==========

  createSession(session: Omit<InvestigationSession, 'id' | 'createdAt' | 'updatedAt'>): InvestigationSession {
    const id = generateId('session');
    const now = new Date().toISOString();

    const fullSession: InvestigationSession = {
      ...session,
      id,
      createdAt: now,
      updatedAt: now
    };

    this.adapter.transaction(() => {
      this.adapter.prepare(`
        INSERT INTO sessions (id, project_id, name, description, status, config_json, authorization_json, created_at, updated_at, created_by, tags_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        fullSession.id,
        fullSession.projectId,
        fullSession.name,
        fullSession.description ?? null,
        fullSession.status,
        JSON.stringify(fullSession.config),
        JSON.stringify(fullSession.authorization),
        fullSession.createdAt,
        fullSession.updatedAt,
        fullSession.createdBy,
        JSON.stringify(fullSession.tags)
      );
      // Targets are registered separately via registerTarget; TargetReference
      // does not carry the full target fields needed for the targets table.
    });

    logger.info({ sessionId: id }, 'Session created');
    return fullSession;
  }

  getSession(id: string): InvestigationSession | null {
    const row = this.adapter.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return null;

    const targets = this.adapter.prepare('SELECT * FROM targets WHERE session_id = ?').all(id) as any[];

    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      targets: targets.map(t => ({
        targetId: t.id,
        role: t.role,
        addedAt: t.added_at
      })),
      authorization: JSON.parse(row.authorization_json),
      status: row.status,
      progress: JSON.parse(row.config_json).progress || { totalSteps: 0, completedSteps: 0, findingsCount: 0, evidenceCount: 0, errors: [] },
      config: JSON.parse(row.config_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      tags: JSON.parse(row.tags_json || '[]')
    };
  }

  getSessionOrThrow(id: string): InvestigationSession {
    const session = this.getSession(id);
    if (!session) {
      throw new NotFoundError('Session', id);
    }
    return session;
  }

  updateSession(id: string, updates: Partial<InvestigationSession>): InvestigationSession | null {
    const session = this.getSession(id);
    if (!session) return null;

    const updated: InvestigationSession = {
      ...session,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    // When progress is updated, merge it into config.progress so it persists
    // in config_json (the sessions table stores config as a single JSON blob).
    const configForStorage = { ...session.config };
    if (updates.progress) {
      configForStorage.progress = { ...session.config.progress, ...updates.progress };
    }

    this.adapter.prepare(`
      UPDATE sessions
      SET name = ?, description = ?, status = ?, config_json = ?, authorization_json = ?, updated_at = ?, tags_json = ?
      WHERE id = ?
    `).run(
      updated.name,
      updated.description ?? null,
      updated.status,
      JSON.stringify(configForStorage),
      JSON.stringify(updated.authorization),
      updated.updatedAt,
      JSON.stringify(updated.tags),
      id
    );

    logger.info({ sessionId: id }, 'Session updated');
    return updated;
  }

  deleteSession(id: string): boolean {
    const result = this.adapter.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    logger.info({ sessionId: id, deleted: result.changes > 0 }, 'Session deleted');
    return result.changes > 0;
  }

  listSessions(projectId?: string): InvestigationSession[] {
    const sql = projectId
      ? 'SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC, rowid DESC'
      : 'SELECT * FROM sessions ORDER BY created_at DESC, rowid DESC';
    const params = projectId ? [projectId] : [];

    const rows = this.adapter.prepare(sql).all(...params) as any[];
    return rows.map(row => this.getSession(row.id)!).filter(Boolean);
  }

  // ========== Target Operations ==========

  registerTarget(sessionId: string, target: Omit<AnalysisTarget, 'id' | 'sessionId' | 'addedAt'>): AnalysisTarget {
    this.getSessionOrThrow(sessionId); // Throws NotFoundError if session missing

    const id = generateId('target');
    const now = new Date().toISOString();

    const fullTarget: AnalysisTarget = {
      ...target,
      id,
      sessionId,
      addedAt: now
    };

    this.adapter.transaction(() => {
      this.adapter.prepare(`
        INSERT INTO targets (id, session_id, type, path, metadata_json, hashes_json, authorization_json, added_at, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sessionId,
        fullTarget.type,
        fullTarget.path,
        JSON.stringify(fullTarget.metadata),
        JSON.stringify(fullTarget.hashes),
        JSON.stringify(fullTarget.authorization),
        now,
        fullTarget.role
      );

      // Update session targets list
      const session = this.getSession(sessionId)!;
      const updatedTargets = [...session.targets, { targetId: id, role: fullTarget.role, addedAt: now }];
      this.adapter.prepare(`
        UPDATE sessions SET config_json = json_set(config_json, '$.targets', ?), updated_at = ? WHERE id = ?
      `).run(JSON.stringify(updatedTargets), new Date().toISOString(), sessionId);
    });

    logger.info({ targetId: id, sessionId }, 'Target registered');
    return fullTarget;
  }

  getTarget(id: string): AnalysisTarget | null {
    const row = this.adapter.prepare('SELECT * FROM targets WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      path: row.path,
      metadata: JSON.parse(row.metadata_json),
      hashes: JSON.parse(row.hashes_json),
      authorization: JSON.parse(row.authorization_json),
      addedAt: row.added_at,
      role: row.role
    };
  }

  getTargetOrThrow(id: string): AnalysisTarget {
    const target = this.getTarget(id);
    if (!target) {
      throw new NotFoundError('Target', id);
    }
    return target;
  }

  getTargetsBySession(sessionId: string): AnalysisTarget[] {
    const rows = this.adapter.prepare('SELECT * FROM targets WHERE session_id = ?').all(sessionId) as any[];
    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      path: row.path,
      metadata: JSON.parse(row.metadata_json),
      hashes: JSON.parse(row.hashes_json),
      authorization: JSON.parse(row.authorization_json),
      addedAt: row.added_at,
      role: row.role
    }));
  }

  // ========== Environment Operations ==========

  createEnvironment(env: Omit<EnvironmentSnapshot, 'id' | 'capturedAt'>): EnvironmentSnapshot {
    const id = generateId('environment');
    const capturedAt = new Date().toISOString();

    const fullEnv: EnvironmentSnapshot = { ...env, id, capturedAt };

    this.adapter.prepare(`
      INSERT INTO environments (id, session_id, os, arch, tools_json, provider_versions_json, target_hash, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      fullEnv.sessionId,
      fullEnv.os,
      fullEnv.arch,
      JSON.stringify(fullEnv.tools),
      JSON.stringify(fullEnv.providerVersions),
      fullEnv.targetHash,
      capturedAt
    );

    return fullEnv;
  }

  getEnvironment(id: string): EnvironmentSnapshot | null {
    const row = this.adapter.prepare('SELECT * FROM environments WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      sessionId: row.session_id,
      os: row.os,
      arch: row.arch,
      tools: JSON.parse(row.tools_json),
      providerVersions: JSON.parse(row.provider_versions_json),
      targetHash: row.target_hash,
      capturedAt: row.captured_at
    };
  }

  getOrCreateEnvironment(sessionId: string, targetHash: string): EnvironmentSnapshot {
    const existing = this.adapter.prepare(
      'SELECT * FROM environments WHERE session_id = ? AND target_hash = ?'
    ).get(sessionId, targetHash) as any;

    if (existing) return this.getEnvironment(existing.id)!;

    // Capture current environment
    const env = this.createEnvironment({
      sessionId,
      os: process.platform,
      arch: process.arch,
      tools: [],
      providerVersions: {},
      targetHash
    });

    return env;
  }

  // ========== Finding Operations ==========

  createFinding(finding: Omit<Finding, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Finding {
    // Validate session and target exist (FK enforcement at application level too)
    this.getSessionOrThrow(finding.sessionId);
    this.getTargetOrThrow(finding.targetId);

    const id = generateId('finding');
    const now = new Date().toISOString();

    const fullFinding: Finding = {
      ...finding,
      id,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    this.adapter.transaction(() => {
      this.adapter.prepare(`
        INSERT INTO findings (
          id, session_id, target_id, provider_id, capability_id, category, severity,
          title, observation, inference, evidence_json, confidence_level, confidence_value,
          confidence_justification, limitations_json, unknowns_json, provenance_json,
          reproducibility_json, tags_json, environment_id, created_at, updated_at, created_by, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        fullFinding.sessionId,
        fullFinding.targetId,
        fullFinding.providerId,
        fullFinding.capabilityId,
        fullFinding.category,
        fullFinding.severity,
        fullFinding.title,
        fullFinding.observation,
        fullFinding.inference ?? null,
        JSON.stringify(fullFinding.evidence),
        fullFinding.confidence.level,
        fullFinding.confidence.value,
        fullFinding.confidence.justification,
        JSON.stringify(fullFinding.limitations),
        JSON.stringify(fullFinding.unknowns),
        JSON.stringify(fullFinding.provenance),
        JSON.stringify(fullFinding.reproducibility),
        JSON.stringify(fullFinding.tags),
        fullFinding.reproducibility.environmentId ?? null,
        fullFinding.createdAt,
        fullFinding.updatedAt,
        fullFinding.createdBy,
        1
      );
    });

    // Update session progress
    this.adapter.prepare(`
      UPDATE sessions SET
        config_json = json_set(config_json, '$.progress.findingsCount',
          (SELECT COUNT(*) FROM findings WHERE session_id = ?)),
        updated_at = ?
      WHERE id = ?
    `).run(fullFinding.sessionId, now, fullFinding.sessionId);

    logger.info({ findingId: id, sessionId: fullFinding.sessionId }, 'Finding created');
    return fullFinding;
  }

  createFindings(findings: Array<Omit<Finding, 'id' | 'createdAt' | 'updatedAt' | 'version'>>): Finding[] {
    return findings.map(f => this.createFinding(f));
  }

  getFinding(id: string): Finding | null {
    const row = this.adapter.prepare('SELECT * FROM findings WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRowToFinding(row);
  }

  getFindingOrThrow(id: string): Finding {
    const finding = this.getFinding(id);
    if (!finding) {
      throw new NotFoundError('Finding', id);
    }
    return finding;
  }

  queryFindings(params: {
    sessionId: string;
    category?: FindingCategory;
    severity?: FindingSeverity;
    confidenceMin?: number;
    capabilityId?: string;
    targetId?: string;
    limit?: number;
    offset?: number;
  }): { findings: Finding[]; total: number; hasMore: boolean } {
    const { sessionId, category, severity, confidenceMin, capabilityId, targetId, limit = 50, offset = 0 } = params;

    // Session must exist
    this.getSessionOrThrow(sessionId);

    let where = 'session_id = ?';
    const args: any[] = [sessionId];

    if (category) { where += ' AND category = ?'; args.push(category); }
    if (severity) { where += ' AND severity = ?'; args.push(severity); }
    if (confidenceMin !== undefined) { where += ' AND confidence_value >= ?'; args.push(confidenceMin); }
    if (capabilityId) { where += ' AND capability_id = ?'; args.push(capabilityId); }
    if (targetId) { where += ' AND target_id = ?'; args.push(targetId); }

    const total = this.adapter.prepare(`SELECT COUNT(*) as count FROM findings WHERE ${where}`).get(...args) as { count: number };

    const rows = this.adapter.prepare(`
      SELECT * FROM findings WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?
    `).all(...args, limit, offset) as any[];

    const findings = rows.map(row => this.mapRowToFinding(row));

    return {
      findings,
      total: total.count,
      hasMore: offset + findings.length < total.count
    };
  }

  private mapRowToFinding(row: any): Finding {
    return {
      id: row.id,
      sessionId: row.session_id,
      targetId: row.target_id,
      providerId: row.provider_id,
      capabilityId: row.capability_id,
      category: row.category,
      severity: row.severity,
      title: row.title,
      observation: row.observation,
      inference: row.inference,
      evidence: JSON.parse(row.evidence_json),
      confidence: {
        level: row.confidence_level,
        value: row.confidence_value,
        justification: row.confidence_justification,
        factors: [] // Stored separately if needed
      },
      limitations: JSON.parse(row.limitations_json),
      unknowns: JSON.parse(row.unknowns_json),
      provenance: JSON.parse(row.provenance_json),
      reproducibility: JSON.parse(row.reproducibility_json),
      tags: JSON.parse(row.tags_json || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      version: row.version
    };
  }

  // ========== Statistics ==========

  getSessionStatistics(sessionId: string): { findingsByCategory: Record<string, number>; findingsBySeverity: Record<string, number>; avgConfidence: number } {
    this.getSessionOrThrow(sessionId);

    const findings = this.adapter.prepare('SELECT * FROM findings WHERE session_id = ?').all(sessionId) as any[];

    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let totalConfidence = 0;

    for (const f of findings) {
      byCategory[f.category] = (byCategory[f.category] || 0) + 1;
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      totalConfidence += f.confidence_value;
    }

    return {
      findingsByCategory: byCategory,
      findingsBySeverity: bySeverity,
      avgConfidence: findings.length > 0 ? totalConfidence / findings.length : 0
    };
  }

  // ========== Audit Log Operations ==========

  writeAuditLog(entry: AuditLogEntry): void {
    const id = generateId('finding'); // Reuse finding ID format (fnd_ prefix) for audit entries
    this.adapter.prepare(`
      INSERT INTO audit_logs (id, session_id, target_id, capability_id, operation, decision, reason, approval_needed_json, timestamp, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.sessionId ?? null,
      entry.targetId ?? null,
      entry.capabilityId ?? null,
      entry.operation,
      entry.decision,
      entry.reason ?? null,
      entry.approvalNeeded ? JSON.stringify(entry.approvalNeeded) : null,
      entry.timestamp,
      entry.details ? JSON.stringify(entry.details) : null
    );
  }

  queryAuditLogs(params: {
    sessionId?: string;
    decision?: 'allow' | 'deny';
    operation?: string;
    limit?: number;
    offset?: number;
  }): { logs: AuditLogEntry[]; total: number } {
    const { sessionId, decision, operation, limit = 50, offset = 0 } = params;

    let where = '1=1';
    const args: any[] = [];

    if (sessionId) { where += ' AND session_id = ?'; args.push(sessionId); }
    if (decision) { where += ' AND decision = ?'; args.push(decision); }
    if (operation) { where += ' AND operation = ?'; args.push(operation); }

    const total = this.adapter.prepare(`SELECT COUNT(*) as count FROM audit_logs WHERE ${where}`).get(...args) as { count: number };

    const rows = this.adapter.prepare(`
      SELECT * FROM audit_logs WHERE ${where} ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?
    `).all(...args, limit, offset) as any[];

    const logs = rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      targetId: row.target_id,
      capabilityId: row.capability_id,
      operation: row.operation,
      decision: row.decision as 'allow' | 'deny',
      reason: row.reason,
      approvalNeeded: row.approval_needed_json ? JSON.parse(row.approval_needed_json) : [],
      timestamp: row.timestamp,
      details: row.details_json ? JSON.parse(row.details_json) : undefined
    }));

    return { logs, total: total.count };
  }
}

export function createRepository(config: RepositoryConfig): Repository {
  return new Repository(config);
}
