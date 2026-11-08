export const SRE_STUDIO_VERSION = '0.1.0';

export const ID_PREFIXES = {
  session: 'ses',
  target: 'tgt',
  finding: 'fnd',
  provider: 'prv',
  environment: 'env'
} as const;

export const FINDING_CATEGORIES = [
  'structure',
  'behavior',
  'code',
  'data',
  'network',
  'security',
  'configuration',
  'dependency',
  'anomaly',
  'other'
] as const;

export const FINDING_SEVERITIES = [
  'critical',
  'high',
  'medium',
  'low',
  'info'
] as const;

export const CONFIDENCE_LEVELS = [
  'high',
  'medium',
  'low',
  'none'
] as const;

export const SESSION_STATUSES = [
  'initialized',
  'running',
  'paused',
  'completed',
  'failed',
  'archived'
] as const;

export const TARGET_TYPES = [
  'binary',
  'android',
  'web',
  'js',
  'dotnet',
  'network'
] as const;

export const TARGET_ROLES = [
  'primary',
  'secondary',
  'reference'
] as const;

export const AUTHORIZATION_TYPES = [
  'owner',
  'explicit-permission',
  'public',
  'authorized-testing'
] as const;

export const CAPABILITY_CATEGORIES = [
  'static-analysis',
  'extraction',
  'parsing'
] as const;

export const APPROVAL_REQUIRED = [
  'dynamic-execution',
  'network-capture',
  'file-modification',
  'external-service',
  'credential-access',
  'high-resource-usage'
] as const;

export const DEFAULT_RESOURCE_LIMITS = {
  maxMemoryMb: 4096,
  maxCpuPercent: 80,
  maxDurationMs: 300000,
  maxConcurrentAnalyses: 10,
  maxDiskUsageMb: 2048
} as const;

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_SERVER_NAME = 'sre-studio';

export function generateId(prefix: keyof typeof ID_PREFIXES): string {
  const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${ID_PREFIXES[prefix]}_${uuid}`;
}

export function isValidFindingCategory(category: string): category is typeof FINDING_CATEGORIES[number] {
  return FINDING_CATEGORIES.includes(category as typeof FINDING_CATEGORIES[number]);
}

export function isValidSeverity(severity: string): severity is typeof FINDING_SEVERITIES[number] {
  return FINDING_SEVERITIES.includes(severity as typeof FINDING_SEVERITIES[number]);
}

export function isValidConfidenceLevel(level: string): level is typeof CONFIDENCE_LEVELS[number] {
  return CONFIDENCE_LEVELS.includes(level as typeof CONFIDENCE_LEVELS[number]);
}

export function isValidSessionStatus(status: string): status is typeof SESSION_STATUSES[number] {
  return SESSION_STATUSES.includes(status as typeof SESSION_STATUSES[number]);
}

export function isValidTargetType(type: string): type is typeof TARGET_TYPES[number] {
  return TARGET_TYPES.includes(type as typeof TARGET_TYPES[number]);
}