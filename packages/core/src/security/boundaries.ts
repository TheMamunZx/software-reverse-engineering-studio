export interface TargetPattern {
  type: 'binary' | 'android' | 'web' | 'js' | 'dotnet' | 'network' | '*';
  pathPattern?: string;
  hashAllowlist?: string[];
}

export interface CapabilityPattern {
  provider?: string;
  capability?: string;
  category?: 'static-analysis' | 'extraction' | 'parsing';
}

export type ApprovalRequired =
  | 'dynamic-execution'
  | 'network-capture'
  | 'file-modification'
  | 'external-service'
  | 'credential-access'
  | 'high-resource-usage';

export interface ResourceLimits {
  maxMemoryMb: number;
  maxCpuPercent: number;
  maxDurationMs: number;
  maxConcurrentAnalyses: number;
  maxDiskUsageMb: number;
}

export interface RedactionRule {
  pattern: string;
  replacement: string;
}

export interface DataHandlingPolicy {
  allowExternalTransmission: boolean;
  redactionRules: RedactionRule[];
  maxRetentionDays: number;
  encryptAtRest: boolean;
}

export interface AuthorizationBoundary {
  allowedTargets: TargetPattern[];
  allowedCapabilities: CapabilityPattern[];
  requiresApproval: ApprovalRequired[];
  limits: ResourceLimits;
  dataHandling: DataHandlingPolicy;
}

export interface AuthorizationResult {
  allowed: boolean;
  approvalNeeded: ApprovalRequired[];
  reason: string | null;
  boundaries: AuthorizationBoundary;
}