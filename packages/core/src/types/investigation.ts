export interface InvestigationSession {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  targets: TargetReference[];
  authorization: AuthorizationRecord;
  status: SessionStatus;
  progress: SessionProgress;
  config: SessionConfig;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  tags: string[];
}

export interface TargetReference {
  targetId: string;
  role: TargetRole;
  addedAt: string;
}

export interface AuthorizationRecord {
  type: AuthorizationType;
  description: string;
  grantedBy?: string;
  grantedAt?: string;
  scope: string[];
  limitations: string[];
  documentReference?: string;
  verified: boolean;
}

export interface SessionProgress {
  totalSteps: number;
  completedSteps: number;
  currentStep?: string;
  findingsCount: number;
  evidenceCount: number;
  errors: string[];
}

export interface SessionConfig {
  providers?: string[];
  resourceLimits?: ResourceLimits;
  progress?: SessionProgress;
}

export interface ResourceLimits {
  maxMemoryMb: number;
  maxCpuPercent: number;
  maxDurationMs: number;
  /** Advisory in Milestone 1; enforced by the sandbox in a later milestone. */
  maxConcurrentAnalyses?: number;
  /** Advisory in Milestone 1; enforced by the sandbox in a later milestone. */
  maxDiskUsageMb?: number;
}

export type SessionStatus = 'initialized' | 'running' | 'paused' | 'completed' | 'failed' | 'archived';
export type TargetRole = 'primary' | 'secondary' | 'reference';
export type AuthorizationType = 'owner' | 'explicit-permission' | 'public' | 'authorized-testing';