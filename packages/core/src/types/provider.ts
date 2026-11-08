import type {
  Finding,
  EvidenceReference,
  SourceLocation,
  ConfidenceScore,
  ConfidenceFactor,
  ProvenanceInfo,
  ReproducibilityInfo,
  ReproductionStep,
  Variation
} from './evidence.js';

export interface CapabilityProvider {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities: ReadonlyArray<ProviderCapability>;
  readonly requiredTools: ReadonlyArray<ExternalToolDependency>;

  initialize(config: ProviderConfig): Promise<InitializationResult>;
  validateEnvironment(): Promise<EnvironmentValidationResult>;
  analyze(request: AnalysisRequest): Promise<AnalysisResult>;
  shutdown(): Promise<void>;
}

export interface ProviderCapability {
  id: string;
  name: string;
  description: string;
  category: CapabilityCategory;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  estimatedDurationMs?: number;
}

export type CapabilityCategory = 'static-analysis' | 'extraction' | 'parsing';

export interface ExternalToolDependency {
  name: string;
  versionConstraint: string;
  verifyCommand: string;
  installHint: Record<'win32' | 'darwin' | 'linux', string>;
  optional?: boolean;
}

export interface ProviderConfig {
  toolPaths?: Record<string, string>;
  maxMemoryMb?: number;
  timeoutMs?: number;
  settings?: Record<string, unknown>;
  cacheDir?: string;
  enableCache?: boolean;
}

export interface InitializationResult {
  success: boolean;
  message?: string;
  availableCapabilities?: string[];
}

export interface EnvironmentValidationResult {
  valid: boolean;
  availableTools: string[];
  missingTools: string[];
  warnings: string[];
}

export interface AnalysisRequest {
  sessionId: string;
  targetId: string;
  capabilityId: string;
  parameters: Record<string, unknown>;
  context?: AnalysisContext;
}

export interface AnalysisContext {
  priorFindings?: string[];
  targetMetadata?: Record<string, unknown>;
  hints?: Record<string, unknown>;
}

export interface AnalysisResult {
  findings: Finding[];
  summary: string;
  statistics: AnalysisStatistics;
  duration: number;
  toolOutputs: ToolOutput[];
  warnings: string[];
  errors: AnalysisError[];
}

export interface AnalysisStatistics {
  findingsByCategory: Record<string, number>;
  findingsBySeverity: Record<string, number>;
  evidenceCount: number;
  avgConfidence: number;
}

export interface ToolOutput {
  tool: string;
  command: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  outputFiles?: string[];
  duration: number;
}

export interface AnalysisError {
  code: string;
  message: string;
  capabilityId?: string;
}

// Re-export types from evidence for convenience
export type {
  Finding,
  EvidenceReference,
  SourceLocation,
  ConfidenceScore,
  ConfidenceFactor,
  ProvenanceInfo,
  ReproducibilityInfo,
  ReproductionStep,
  Variation
};