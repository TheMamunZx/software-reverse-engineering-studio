import type {
  CapabilityProvider,
  ProviderCapability,
  ProviderConfig,
  InitializationResult,
  EnvironmentValidationResult,
  AnalysisRequest,
  AnalysisResult,
  ExternalToolDependency,
  Finding,
  EvidenceReference,
  ConfidenceScore,
  ProvenanceInfo,
  ReproducibilityInfo,
  ConfidenceFactor
} from '../types/provider.js';
import type { FindingCategory, FindingSeverity } from '../types/evidence.js';
import { EvidenceEngine } from '../evidence/evidence-engine.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('base-provider');

export abstract class BaseProvider implements CapabilityProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly description: string;
  abstract readonly capabilities: ReadonlyArray<ProviderCapability>;
  abstract readonly requiredTools: ReadonlyArray<ExternalToolDependency>;

  protected config!: ProviderConfig;
  protected evidenceEngine!: EvidenceEngine;

  async initialize(config: ProviderConfig): Promise<InitializationResult> {
    this.config = config;
    await this.validateTools();
    return this.doInitialize();
  }

  protected abstract doInitialize(): Promise<InitializationResult>;
  protected abstract doAnalyze(request: AnalysisRequest): Promise<AnalysisResult>;

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();
    logger.info({ providerId: this.id, capabilityId: request.capabilityId, targetId: request.targetId }, 'Starting analysis');

    try {
      const result = await this.doAnalyze(request);
      const duration = Date.now() - startTime;

      logger.info({
        providerId: this.id,
        capabilityId: request.capabilityId,
        findingsCount: result.findings.length,
        duration
      }, 'Analysis completed');

      return { ...result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error({
        providerId: this.id,
        capabilityId: request.capabilityId,
        duration,
        error: error instanceof Error ? error.message : String(error)
      }, 'Analysis failed');
      throw error;
    }
  }

  async validateEnvironment(): Promise<EnvironmentValidationResult> {
    const availableTools: string[] = [];
    const missingTools: string[] = [];
    const warnings: string[] = [];

    for (const tool of this.requiredTools) {
      try {
        const { spawnSync } = await import('node:child_process');
        const parts = tool.verifyCommand.split(/\s+/);
        const cmd = parts[0] || tool.name;
        const args = parts.slice(1);
        const result = spawnSync(cmd, args, { shell: false, encoding: 'utf-8', timeout: 5000 });
        if (result.status === 0 && !result.error) {
          availableTools.push(tool.name);
        } else {
          missingTools.push(tool.name);
          warnings.push(`Required tool missing: ${tool.name}`);
        }
      } catch {
        missingTools.push(tool.name);
        warnings.push(`Required tool missing: ${tool.name}`);
      }
    }

    return {
      valid: missingTools.length === 0,
      availableTools,
      missingTools,
      warnings
    };
  }

  async shutdown(): Promise<void> {
    logger.info({ providerId: this.id }, 'Provider shutdown');
  }

  protected async validateTools(): Promise<void> {
    const validation = await this.validateEnvironment();
    if (!validation.valid) {
      throw new Error(`Required tools missing: ${validation.missingTools.join(', ')}`);
    }
  }

  protected createFinding(input: {
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
    tags?: string[];
    createdBy: string;
  }): Finding {
    return this.evidenceEngine.createFinding(input);
  }

  protected createEvidenceReference(input: {
    type: EvidenceReference['type'];
    location: EvidenceReference['location'];
    excerpt?: string;
    tool?: string;
  }): EvidenceReference {
    return this.evidenceEngine.createEvidenceReference(input);
  }

  protected calculateConfidence(factors: ConfidenceFactor[]): ConfidenceScore {
    return this.evidenceEngine.calculateConfidence(factors);
  }

  protected createProvenance(input: {
    derivedFrom: string[];
    tool: string;
    command: string;
    parameters: Record<string, unknown>;
    duration: number;
    toolVersion: string;
  }): ProvenanceInfo {
    return this.evidenceEngine.createProvenance(input);
  }

  protected createReproducibility(input: {
    reproducible: boolean;
    environmentId: string;
    steps: ReproducibilityInfo['steps'];
    knownVariations?: ReproducibilityInfo['knownVariations'];
  }): ReproducibilityInfo {
    return this.evidenceEngine.createReproducibility(input);
  }

  protected async execTool(command: string, args: string[], options: { timeout?: number } = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(command, args, {
      encoding: 'utf-8',
      timeout: options.timeout ?? this.config.timeoutMs ?? 300000,
      shell: true
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.status ?? 1
    };
  }
}