export interface Finding {
  id: string;
  sessionId: string;
  targetId: string;
  providerId: string;
  capabilityId: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  observation: string;
  inference?: string;
  evidence: EvidenceReference[];
  confidence: ConfidenceScore;
  limitations: string[];
  unknowns: string[];
  provenance: ProvenanceInfo;
  reproducibility: ReproducibilityInfo;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  version: number;
}

export interface EvidenceReference {
  id: string;
  type: EvidenceType;
  location: SourceLocation;
  excerpt?: string;
  hash?: string;
  timestamp: string;
  tool?: string;
}

export interface SourceLocation {
  file?: string;
  offset?: number;
  length?: number;
  address?: string;
  function?: string;
  line?: number;
  column?: number;
  url?: string;
  packet?: number;
}

export interface ConfidenceScore {
  level: ConfidenceLevel;
  value: number;
  justification: string;
  factors: ConfidenceFactor[];
}

export interface ConfidenceFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
  weight: number;
}

export interface ProvenanceInfo {
  derivedFrom: string[];
  tool: string;
  command: string;
  parameters: Record<string, unknown>;
  duration: number;
  toolVersion: string;
}

export interface ReproducibilityInfo {
  reproducible: boolean;
  /**
   * FK to environments.id.  Optional because some findings are created before
   * an environment snapshot is captured (e.g. in unit tests or when the
   * provider does not support environment capture).  The SQLite column is
   * nullable; a null value simply means "no environment recorded".
   */
  environmentId: string | undefined;
  steps: ReproductionStep[];
  knownVariations: Variation[];
}

export interface ReproductionStep {
  order: number;
  action: string;
  tool: string;
  parameters: Record<string, unknown>;
  expectedOutcome: string;
}

export interface Variation {
  condition: string;
  effectOnFinding: 'none' | 'minor' | 'major' | 'invalidates';
}

export interface EnvironmentSnapshot {
  id: string;
  sessionId: string;
  os: string;
  arch: string;
  tools: ToolVersion[];
  providerVersions: Record<string, string>;
  targetHash: string;
  capturedAt: string;
}

export interface ToolVersion {
  name: string;
  version: string;
  path: string;
}

export type FindingCategory = 'structure' | 'behavior' | 'code' | 'data' | 'network' | 'security' | 'configuration' | 'dependency' | 'anomaly' | 'other';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';
export type EvidenceType = 'file' | 'memory' | 'network' | 'tool-output' | 'observation';