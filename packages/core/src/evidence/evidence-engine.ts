import type {
  Finding,
  EvidenceReference,
  ConfidenceScore,
  ProvenanceInfo,
  ReproducibilityInfo,
  EnvironmentSnapshot,
  ConfidenceFactor,
  FindingCategory,
  FindingSeverity
} from '../types/evidence.js';
import { generateId, ValidationError, NotFoundError } from '@sre-studio/shared';
import { Repository } from '../storage/repository.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('evidence-engine');

export interface EvidenceEngineConfig {
  repository: Repository;
}

export class EvidenceEngine {
  private repository: Repository;

  constructor(config: EvidenceEngineConfig) {
    this.repository = config.repository;
  }

  /**
   * Creates a single finding and persists it to SQLite.
   * Validates that the session and target exist and that the confidence
   * score is within range before persisting.
   */
  createFinding(input: {
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
    this.validateSession(input.sessionId);
    this.validateTarget(input.targetId);
    this.validateConfidence(input.confidence);
    this.validateEvidence(input.evidence);

    const finding = this.repository.createFinding({
      ...input,
      tags: input.tags ?? [],
      createdBy: input.createdBy
    });

    logger.info({ findingId: finding.id, sessionId: input.sessionId }, 'Finding created via EvidenceEngine');
    return finding;
  }

  createFindings(inputs: Array<Parameters<EvidenceEngine['createFinding']>[0]>): Finding[] {
    return inputs.map(input => this.createFinding(input));
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
  }) {
    return this.repository.queryFindings(params);
  }

  getFinding(id: string): Finding | null {
    return this.repository.getFinding(id);
  }

  getFindingOrThrow(id: string): Finding {
    return this.repository.getFindingOrThrow(id);
  }

  getSessionStatistics(sessionId: string) {
    return this.repository.getSessionStatistics(sessionId);
  }

  calculateConfidence(factors: ConfidenceFactor[]): ConfidenceScore {
    let value = 0.5; // Base confidence

    for (const factor of factors) {
      switch (factor.impact) {
        case 'positive':
          value += factor.weight * 0.15;
          break;
        case 'negative':
          value -= factor.weight * 0.2;
          break;
        case 'neutral':
          // No change
          break;
      }
    }

    // Clamp to [0, 1]
    value = Math.max(0, Math.min(1, value));

    let level: ConfidenceScore['level'];
    if (value >= 0.8) level = 'high';
    else if (value >= 0.5) level = 'medium';
    else if (value > 0) level = 'low';
    else level = 'none';

    const justification = factors
      .map(f => `${f.name}: ${f.impact} (${f.description})`)
      .join('; ');

    return {
      level,
      value: Math.round(value * 100) / 100,
      justification: justification || 'No factors provided',
      factors
    };
  }

  createEvidenceReference(input: {
    type: EvidenceReference['type'];
    location: EvidenceReference['location'];
    excerpt?: string;
    tool?: string;
  }): EvidenceReference {
    const excerpt = input.excerpt ?? '';
    const hash = this.hashContent(excerpt + JSON.stringify(input.location));

    return {
      id: generateId('finding'), // Reusing finding ID format for evidence
      type: input.type,
      location: input.location,
      excerpt: excerpt.slice(0, 1000),
      hash,
      timestamp: new Date().toISOString(),
      tool: input.tool
    };
  }

  createProvenance(input: {
    derivedFrom: string[];
    tool: string;
    command: string;
    parameters: Record<string, unknown>;
    duration: number;
    toolVersion: string;
  }): ProvenanceInfo {
    return {
      derivedFrom: input.derivedFrom,
      tool: input.tool,
      command: input.command,
      parameters: input.parameters,
      duration: input.duration,
      toolVersion: input.toolVersion
    };
  }

  createReproducibility(input: {
    reproducible: boolean;
    environmentId?: string;
    steps: ReproducibilityInfo['steps'];
    knownVariations?: ReproducibilityInfo['knownVariations'];
  }): ReproducibilityInfo {
    return {
      reproducible: input.reproducible,
      environmentId: input.environmentId,
      steps: input.steps,
      knownVariations: input.knownVariations ?? []
    };
  }

  private hashContent(content: string): string {
    // Simple hash for excerpt verification
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  // ========== Validation ==========

  private validateSession(sessionId: string): void {
    const session = this.repository.getSession(sessionId);
    if (!session) {
      throw new NotFoundError('Session', sessionId);
    }
  }

  private validateTarget(targetId: string): void {
    const target = this.repository.getTarget(targetId);
    if (!target) {
      throw new NotFoundError('Target', targetId);
    }
  }

  private validateConfidence(confidence: ConfidenceScore): void {
    if (confidence.value < 0 || confidence.value > 1) {
      throw new ValidationError(
        `Confidence value must be between 0 and 1, got ${confidence.value}`,
        'confidence.value',
        { value: confidence.value }
      );
    }
    if (!confidence.justification || confidence.justification.trim().length === 0) {
      throw new ValidationError(
        'Confidence justification is required',
        'confidence.justification'
      );
    }
  }

  private validateEvidence(evidence: EvidenceReference[]): void {
    for (const ref of evidence) {
      if (!ref.type) {
        throw new ValidationError('Evidence reference type is required', 'evidence.type');
      }
      if (!ref.location) {
        throw new ValidationError('Evidence reference location is required', 'evidence.location');
      }
    }
  }
}

export function createEvidenceEngine(config: EvidenceEngineConfig): EvidenceEngine {
  return new EvidenceEngine(config);
}
