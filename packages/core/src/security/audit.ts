import { createLogger } from '@sre-studio/shared';

const auditLogger = createLogger('audit', { level: 'info' });

export interface AuditEntry {
  timestamp: string;
  action: string;
  sessionId?: string;
  targetId?: string;
  capabilityId?: string;
  user?: string;
  decision: 'allow' | 'deny' | 'error';
  reason?: string;
  details?: Record<string, unknown>;
}

export class AuditLogger {
  log(entry: AuditEntry): void {
    auditLogger.info(entry, 'Audit event');
  }

  logAuthorization(entry: Omit<AuditEntry, 'action'> & { action: 'authorization' }): void {
    this.log({ ...entry, action: 'authorization' });
  }

  logAnalysis(entry: Omit<AuditEntry, 'action'> & { action: 'analysis' }): void {
    this.log({ ...entry, action: 'analysis' });
  }

  logSession(entry: Omit<AuditEntry, 'action'> & { action: 'session' }): void {
    this.log({ ...entry, action: 'session' });
  }

  logTarget(entry: Omit<AuditEntry, 'action'> & { action: 'target' }): void {
    this.log({ ...entry, action: 'target' });
  }

  logEvidence(entry: Omit<AuditEntry, 'action'> & { action: 'evidence' }): void {
    this.log({ ...entry, action: 'evidence' });
  }
}

export const auditLoggerInstance = new AuditLogger();