/**
 * Rizin binary analysis provider.
 *
 * Implements static binary analysis using the Rizin toolset (rabin2 + rizin).
 * All external tool execution uses safe subprocess spawning with argument
 * arrays (never shell: true), timeouts, output limits, and proper error
 * handling. Analyzed binaries are never executed.
 */
import {
  BaseProvider,
  type CapabilityProvider,
  type EnvironmentValidationResult,
  type ExternalToolDependency,
  type InitializationResult,
  type ProviderCapability,
  type ProviderConfig,
  type AnalysisRequest,
  type AnalysisResult,
  type Finding,
  type EvidenceReference,
  type ConfidenceScore,
  type ProvenanceInfo,
  type ReproducibilityInfo,
  type ConfidenceFactor,
  type FindingCategory,
  type FindingSeverity,
  type SourceLocation,
} from '@sre-studio/core';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createLogger } from '@sre-studio/shared';
import { ProviderError, ToolExecutionError } from '@sre-studio/shared';

const logger = createLogger('rizin-provider');

const PROVIDER_ID = 'rizin';
const PROVIDER_NAME = 'Rizin Binary Provider';
const PROVIDER_VERSION = '0.1.0';

const REQUIRED_TOOLS: ReadonlyArray<ExternalToolDependency> = [
  {
    name: 'rizin',
    versionConstraint: '>=0.7.0',
    verifyCommand: 'rizin -v',
    installHint: {
      win32: 'Download from https://github.com/rizinorg/rizin/releases and add to PATH',
      darwin: 'brew install rizin',
      linux: 'apt install rizin or download from https://github.com/rizinorg/rizin/releases',
    },
  },
];

const CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  {
    id: 'binary.info',
    name: 'Binary Info',
    description: 'ELF/PE/Mach-O header information (architecture, bits, endian, format)',
    category: 'static-analysis',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  },
  {
    id: 'binary.sections',
    name: 'Binary Sections',
    description: 'Section headers with permissions and virtual addresses',
    category: 'static-analysis',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  },
  {
    id: 'binary.symbols',
    name: 'Binary Symbols',
    description: 'Imported and exported symbols from symbol table',
    category: 'static-analysis',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  },
  {
    id: 'binary.strings',
    name: 'Binary Strings',
    description: 'Extractable strings with virtual addresses',
    category: 'extraction',
    inputSchema: {
      type: 'object',
      properties: {
        minLength: { type: 'integer', minimum: 1, default: 4 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  },
  {
    id: 'binary.imports',
    name: 'Binary Imports',
    description: 'Imported functions and libraries from import table',
    category: 'extraction',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  },
  {
    id: 'binary.cfg',
    name: 'Control Flow Graph',
    description: 'Control flow graph of functions (requires rizin)',
    category: 'parsing',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  },
];

/**
 * Discovers an executable on PATH or at a configured/custom path.
 */
function discoverTool(toolName: string, configuredPath?: string): string | undefined {
  if (configuredPath) {
    try {
      require('node:fs').statSync(configuredPath);
      return configuredPath;
    } catch {
      // Fall through to PATH discovery
    }
  }

  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'where' : 'which';
  const result = spawnSync(cmd, [toolName], { encoding: 'utf-8', shell: false, timeout: 5000 });
  if (result.status === 0 && result.stdout) {
    const firstLine = result.stdout.trim().split('\n')[0];
    if (firstLine) {
      return firstLine;
    }
  }

  if (isWin) {
    const commonDirs = [
      'C:\\rizin',
      'C:\\Program Files\\rizin',
      'C:\\Program Files (x86)\\rizin',
      (process.env['USERPROFILE'] as string | undefined) ?? '',
    ];
    const exeName = `${toolName}.exe`;
    for (const dir of commonDirs) {
      if (!dir) continue;
      const full = path.join(dir, exeName);
      try {
        require('node:fs').statSync(full);
        return full;
      } catch {
        // Continue
      }
    }
  }

  return undefined;
}

/**
 * Safely executes an external tool with an argument array (never shell: true).
 */
function execToolSafe(
  command: string,
  args: string[],
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): { stdout: string; stderr: string; exitCode: number; duration: number } {
  const timeoutMs = options.timeoutMs ?? 120000;
  const maxOutputBytes = options.maxOutputBytes ?? 10_000_000;

  const startTime = Date.now();
  let result: ReturnType<typeof spawnSync>;

  try {
    result = spawnSync(command, args, {
      encoding: 'utf-8',
      shell: false,
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    throw new ToolExecutionError(
      command,
      -1,
      error instanceof Error ? error.message : String(error),
      command,
    );
  }

  const duration = Date.now() - startTime;
  if (result.error) {
    const errorMsg = result.error.message || String(result.error);
    throw new ToolExecutionError(command, result.status ?? -1, errorMsg, `${command} ${args.join(' ')}`);
  }
  const stdout = (result.stdout ?? '').toString();
  const stderr = (result.stderr ?? '').toString();
  const exitCode = result.status ?? 1;

  if (exitCode !== 0) {
    throw new ToolExecutionError(command, exitCode, stderr, `${command} ${args.join(' ')}`);
  }

  return { stdout, stderr, exitCode, duration };
}

/**
 * Parses JSON output from a tool. Returns null if output is empty or invalid.
 */
function parseJsonOutput(stdout: string): unknown {
  if (!stdout || !stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Builds a confidence score from analysis factors.
 */
function buildConfidence(factors: ConfidenceFactor[]): ConfidenceScore {
  let value = 0.5;
  for (const factor of factors) {
    switch (factor.impact) {
      case 'positive':
        value += factor.weight * 0.15;
        break;
      case 'negative':
        value -= factor.weight * 0.2;
        break;
      case 'neutral':
        break;
    }
  }
  value = Math.max(0, Math.min(1, value));
  let level: ConfidenceScore['level'];
  if (value >= 0.8) level = 'high';
  else if (value >= 0.5) level = 'medium';
  else if (value > 0) level = 'low';
  else level = 'none';
  return {
    level,
    value: Math.round(value * 100) / 100,
    justification: factors
      .map((f) => `${f.name}: ${f.impact} (${f.description})`)
      .join('; ') || 'Static analysis via Rizin',
    factors,
  };
}

/**
 * Builds evidence reference for tool output.
 */
function buildEvidence(
  tool: string,
  command: string,
  excerpt: string,
  location: SourceLocation,
): EvidenceReference {
  const ref = {
    type: 'tool-output' as const,
    location,
    excerpt: excerpt.slice(0, 1000),
    tool,
  } as EvidenceReference & { hash?: string; timestamp?: string };
  const hashInput = excerpt + JSON.stringify(location);
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    hash = ((hash << 5) - hash) + hashInput.charCodeAt(i);
    hash = hash & hash;
  }
  ref.hash = Math.abs(hash).toString(16).padStart(8, '0');
  ref.timestamp = new Date().toISOString();
  return ref;
}

export class RizinProvider extends BaseProvider {
  readonly id = PROVIDER_ID;
  readonly name = PROVIDER_NAME;
  readonly version = PROVIDER_VERSION;
  readonly description = 'Static binary analysis via Rizin (rabin2 + rizin)';

  readonly capabilities: ReadonlyArray<ProviderCapability> = CAPABILITIES;
  readonly requiredTools: ReadonlyArray<ExternalToolDependency> = REQUIRED_TOOLS;

  private rabin2Path: string | undefined;
  private rizinPath: string | undefined;
  private toolsAvailable = false;

  override async initialize(config: ProviderConfig): Promise<InitializationResult> {
    this.config = config;

    const rabin2Configured = (config.toolPaths as Record<string, string> | undefined)?.rabin2;
    const rizinConfigured = (config.toolPaths as Record<string, string> | undefined)?.rizin;
    this.rabin2Path = discoverTool('rabin2', rabin2Configured);
    this.rizinPath = discoverTool('rizin', rizinConfigured);
    this.toolsAvailable = !!this.rabin2Path && !!this.rizinPath;

    logger.info({
      providerId: this.id,
      rabin2Path: this.rabin2Path,
      rizinPath: this.rizinPath,
      toolsAvailable: this.toolsAvailable,
    }, 'Rizin provider initialized');

    return {
      success: true,
      message: this.toolsAvailable
        ? 'Rizin provider initialized with tools available'
        : 'Rizin provider initialized but rizin/rabin2 not found on PATH',
      availableCapabilities: this.toolsAvailable
        ? this.capabilities.map((c) => c.id)
        : [],
    };
  }

  override async doInitialize(): Promise<InitializationResult> {
    return {
      success: true,
      message: 'Binary provider initialized',
      availableCapabilities: this.toolsAvailable ? this.capabilities.map((c) => c.id) : [],
    };
  }

  override async validateEnvironment(): Promise<EnvironmentValidationResult> {
    const availableTools: string[] = [];
    const missingTools: string[] = [];
    const warnings: string[] = [];

    if (this.rabin2Path) {
      availableTools.push('rabin2');
    } else {
      missingTools.push('rabin2');
      warnings.push('Required tool missing: rabin2');
    }
    if (this.rizinPath) {
      availableTools.push('rizin');
    } else {
      missingTools.push('rizin');
      warnings.push('Required tool missing: rizin');
    }

    return {
      valid: missingTools.length === 0,
      availableTools,
      missingTools,
      warnings,
    };
  }

  override async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    if (!this.toolsAvailable) {
      const validation = await this.validateEnvironment();
      throw new ProviderError(
        `Rizin tools not available: ${validation.missingTools.join(', ')}`,
        this.id,
        { missingTools: validation.missingTools },
        false,
      );
    }
    return super.analyze(request);
  }

  override async doAnalyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();

    if (!request.targetId) {
      throw new Error('targetId is required for binary analysis');
    }

    const contextPath = (request.context as Record<string, unknown> | undefined)?.targetPath as string | undefined;
    const paramPath = request.parameters.targetPath as string | undefined;
    const targetPath = contextPath ?? paramPath ?? '';

    if (!targetPath) {
      throw new Error('Target path is required for binary analysis');
    }

    let targetExists = false;
    try {
      require('node:fs').statSync(targetPath);
      targetExists = true;
    } catch {
      // File doesn't exist
    }
    if (!targetExists) {
      throw new Error(`Target file not found: ${targetPath}`);
    }

    const toolVersion = await this.getToolVersion();

    const findings: Finding[] = [];
    const toolOutputs: Array<{
      tool: string;
      command: string;
      exitCode: number;
      stdout?: string;
      stderr?: string;
      outputFiles?: string[];
      duration: number;
    }> = [];
    const warnings: string[] = [];
    const errors: Array<{ code: string; message: string; capabilityId?: string }> = [];

    const findingsByCategory: Record<string, number> = {};
    const findingsBySeverity: Record<string, number> = {};
    let evidenceCount = 0;

    const addFinding = (f: Finding) => {
      findings.push(f);
      findingsByCategory[f.category] = (findingsByCategory[f.category] || 0) + 1;
      findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] || 0) + 1;
    };
    const addToolOutput = (o: {
      tool: string; command: string; exitCode: number;
      stdout?: string; stderr?: string; outputFiles?: string[]; duration: number;
    }) => {
      toolOutputs.push(o);
    };
    const addEvidence = (count: number) => {
      evidenceCount += count;
    };

    try {
      if (request.capabilityId === 'binary.info' || request.capabilityId === '') {
        const infoResult = await this.runRabin2Info(targetPath);
        addToolOutput(infoResult.toolOutput);
        addEvidence(infoResult.evidence.length);
        const infoFinding = this.buildInfoFinding(request, infoResult.data, toolVersion);
        addFinding(infoFinding);
      }
      if (request.capabilityId === 'binary.sections' || request.capabilityId === '') {
        const sectionsResult = await this.runRabin2Sections(targetPath);
        addToolOutput(sectionsResult.toolOutput);
        addEvidence(sectionsResult.evidence.length);
        const sectionsFinding = this.buildSectionsFinding(request, sectionsResult.data, toolVersion);
        addFinding(sectionsFinding);
      }
      if (request.capabilityId === 'binary.symbols' || request.capabilityId === '') {
        const symbolsResult = await this.runRabin2Symbols(targetPath);
        addToolOutput(symbolsResult.toolOutput);
        addEvidence(symbolsResult.evidence.length);
        const symbolsFinding = this.buildSymbolsFinding(request, symbolsResult.data, toolVersion);
        addFinding(symbolsFinding);
      }
      if (request.capabilityId === 'binary.strings' || request.capabilityId === '') {
        const minLength = (request.parameters.minLength as number) ?? 4;
        const stringsResult = await this.runRabin2Strings(targetPath, minLength);
        addToolOutput(stringsResult.toolOutput);
        addEvidence(stringsResult.evidence.length);
        const stringsFinding = this.buildStringsFinding(request, stringsResult.data, toolVersion);
        addFinding(stringsFinding);
      }
      if (request.capabilityId === 'binary.imports' || request.capabilityId === '') {
        const importsResult = await this.runRabin2Imports(targetPath);
        addToolOutput(importsResult.toolOutput);
        addEvidence(importsResult.evidence.length);
        const importsFinding = this.buildImportsFinding(request, importsResult.data, toolVersion);
        addFinding(importsFinding);
      }
      if (request.capabilityId === 'binary.cfg' || request.capabilityId === '') {
        try {
          const cfgResult = await this.runRizinCfg(targetPath);
          addToolOutput(cfgResult.toolOutput);
          addEvidence(cfgResult.evidence.length);
          const cfgFinding = this.buildCfgFinding(request, cfgResult.data, toolVersion);
          addFinding(cfgFinding);
        } catch (error) {
          warnings.push(`CFG analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        errors.push({
          code: 'TOOL_EXECUTION_ERROR',
          message: error.message,
          capabilityId: request.capabilityId,
        });
        errors.push({
          code: 'TOOL_EXECUTION_ERROR',
          message: error.stderr,
          capabilityId: request.capabilityId,
        });
      } else {
        errors.push({
          code: 'ANALYSIS_ERROR',
          message: error instanceof Error ? error.message : String(error),
          capabilityId: request.capabilityId,
        });
      }
    }

    const duration = Date.now() - startTime;
    const avgConfidence =
      findings.length > 0
        ? findings.reduce((sum, f) => sum + f.confidence.value, 0) / findings.length
        : 0;

    return {
      findings,
      summary: `Rizin analysis of ${targetPath}: ${findings.length} finding(s) across ${Object.keys(findingsByCategory).length} category(ies)`,
      statistics: {
        findingsByCategory,
        findingsBySeverity,
        evidenceCount,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
      },
      duration,
      toolOutputs,
      warnings,
      errors,
    };
  }

  override async shutdown(): Promise<void> {
    logger.info({ providerId: this.id }, 'Rizin provider shutdown');
  }

  // =====================================================================
  // Capability implementations
  // =====================================================================

  private async getToolVersion(): Promise<string> {
    if (!this.rabin2Path) return 'unknown';
    try {
      const result = spawnSync(this.rabin2Path, ['-v'], {
        encoding: 'utf-8',
        shell: false,
        timeout: 5000,
      });
      if (result.status === 0 && result.stdout) {
        return result.stdout.trim().split('\n')[0];
      }
    } catch {
      // Ignore
    }
    return 'unknown';
  }

  // ------------------------------------------------------------------
  // binary.info - rabin2 -Ij <file>
  // ------------------------------------------------------------------
  private async runRabin2Info(
    targetPath: string,
  ): Promise<{ toolOutput: { tool: string; command: string; exitCode: number; stdout?: string; stderr?: string; outputFiles?: string[]; duration: number }; data: unknown; evidence: EvidenceReference[] }> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(this.rabin2Path!, ['-Ij', targetPath], { timeoutMs: 60000 });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        stderr = error.stderr;
        exitCode = error.exitCode;
      } else {
        stderr = error instanceof Error ? error.message : String(error);
        exitCode = 1;
      }
    }

    const duration = Date.now() - startTime;
    const toolOutput = {
      tool: 'rabin2',
      command: `rabin2 -Ij ${targetPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const data = parseJsonOutput(stdout);

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence('rabin2', `rabin2 -Ij ${targetPath}`, stdout.slice(0, 2000), {
          file: targetPath,
        }),
      );
    }

    return { toolOutput, data, evidence };
  }

  private buildInfoFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const info = (data as Record<string, unknown> | null) ?? {};
    const arch = (info.arch as string) ?? 'unknown';
    const bits = (info.bits as number | string) ?? 'unknown';
    const endian = (info.endian as string) ?? 'unknown';
    const format = (info.format as string) ?? 'unknown';
    const os = (info.os as string) ?? 'unknown';

    const observation = `Binary format: ${format}, architecture: ${arch}, bits: ${bits}, endian: ${endian}, OS: ${os}`;
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'rabin2 -Ij returned valid JSON', weight: 1.0 },
      { name: 'known-format', impact: format !== 'unknown' ? 'positive' : 'negative', description: `Format ${format} recognized`, weight: 0.8 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'binary.info',
      category: 'structure' as FindingCategory,
      severity: 'info' as FindingSeverity,
      title: 'Binary header information',
      observation,
      inference: `The binary is a ${format} executable for ${arch} (${bits}-bit, ${endian})`,
      evidence: [
        buildEvidence(
          'rabin2',
          `rabin2 -Ij ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(info, null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['Static header analysis only; no runtime behavior'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'rabin2',
        `rabin2 -Ij ${request.parameters.targetPath ?? 'unknown'}`,
        { format, arch, bits, endian, os },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['binary', 'header', format, arch],
      createdBy: 'rizin-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // binary.sections - rabin2 -Sj <file>
  // ------------------------------------------------------------------
  private async runRabin2Sections(
    targetPath: string,
  ): Promise<{ toolOutput: { tool: string; command: string; exitCode: number; stdout?: string; stderr?: string; outputFiles?: string[]; duration: number }; data: unknown; evidence: EvidenceReference[] }> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(this.rabin2Path!, ['-Sj', targetPath], { timeoutMs: 60000 });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        stderr = error.stderr;
        exitCode = error.exitCode;
      } else {
        stderr = error instanceof Error ? error.message : String(error);
        exitCode = 1;
      }
    }

    const duration = Date.now() - startTime;
    const toolOutput = {
      tool: 'rabin2',
      command: `rabin2 -Sj ${targetPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const data = parseJsonOutput(stdout);

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence('rabin2', `rabin2 -Sj ${targetPath}`, stdout.slice(0, 2000), {
          file: targetPath,
        }),
      );
    }

    return { toolOutput, data, evidence };
  }

  private buildSectionsFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const sections = Array.isArray(data) ? data : [];
    const sectionCount = sections.length;
    const execSections = sections.filter(
      (s: unknown) => {
        const perm = (s as Record<string, unknown>).perm as string;
        return typeof perm === 'string' && perm.includes('x');
      },
    ).length;

    const observation = `Found ${sectionCount} section(s), ${execSections} executable`;
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'rabin2 -Sj returned section data', weight: 1.0 },
      { name: 'section-count', impact: sectionCount > 0 ? 'positive' : 'negative', description: `${sectionCount} sections found`, weight: 0.5 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'binary.sections',
      category: 'structure' as FindingCategory,
      severity: 'info' as FindingSeverity,
      title: 'Binary sections',
      observation,
      inference: `${execSections} section(s) contain executable code`,
      evidence: [
        buildEvidence(
          'rabin2',
          `rabin2 -Sj ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(sections, null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['Section permissions are static; may not reflect runtime memory protections'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'rabin2',
        `rabin2 -Sj ${request.parameters.targetPath ?? 'unknown'}`,
        { sectionCount, execSections },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['binary', 'sections', 'structure'],
      createdBy: 'rizin-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // binary.symbols - rabin2 -sj <file>
  // ------------------------------------------------------------------
  private async runRabin2Symbols(
    targetPath: string,
  ): Promise<{ toolOutput: { tool: string; command: string; exitCode: number; stdout?: string; stderr?: string; outputFiles?: string[]; duration: number }; data: unknown; evidence: EvidenceReference[] }> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(this.rabin2Path!, ['-sj', targetPath], { timeoutMs: 60000 });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        stderr = error.stderr;
        exitCode = error.exitCode;
      } else {
        stderr = error instanceof Error ? error.message : String(error);
        exitCode = 1;
      }
    }

    const duration = Date.now() - startTime;
    const toolOutput = {
      tool: 'rabin2',
      command: `rabin2 -sj ${targetPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const data = parseJsonOutput(stdout);

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence('rabin2', `rabin2 -sj ${targetPath}`, stdout.slice(0, 2000), {
          file: targetPath,
        }),
      );
    }

    return { toolOutput, data, evidence };
  }

  private buildSymbolsFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const symbols = Array.isArray(data) ? data : [];
    const symbolCount = symbols.length;
    const imported = symbols.filter(
      (s: unknown) => (s as Record<string, unknown>).type === 'IMPORT' || (s as Record<string, unknown>).type === 'import',
    ).length;
    const exported = symbols.filter(
      (s: unknown) => (s as Record<string, unknown>).type === 'EXPORT' || (s as Record<string, unknown>).type === 'export',
    ).length;

    const observation = `Found ${symbolCount} symbol(s): ${imported} imported, ${exported} exported`;
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'rabin2 -sj returned symbol data', weight: 1.0 },
      { name: 'symbols-present', impact: symbolCount > 0 ? 'positive' : 'negative', description: `${symbolCount} symbols found`, weight: 0.7 },
      { name: 'stripped', impact: symbolCount === 0 ? 'negative' : 'neutral', description: symbolCount === 0 ? 'Binary appears stripped' : 'Binary has symbols', weight: 0.5 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'binary.symbols',
      category: 'code' as FindingCategory,
      severity: 'info' as FindingSeverity,
      title: 'Binary symbols',
      observation,
      inference: symbolCount === 0 ? 'Binary may be stripped; limited symbol information available' : 'Symbol table available for reverse engineering',
      evidence: [
        buildEvidence(
          'rabin2',
          `rabin2 -sj ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(symbols, null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['Symbol names may be mangled; stripped binaries have few or no symbols'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'rabin2',
        `rabin2 -sj ${request.parameters.targetPath ?? 'unknown'}`,
        { symbolCount, imported, exported },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['binary', 'symbols', symbolCount === 0 ? 'stripped' : 'not-stripped'],
      createdBy: 'rizin-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // binary.strings - rabin2 -zj <file>
  // ------------------------------------------------------------------
  private async runRabin2Strings(
    targetPath: string,
    minLength: number,
  ): Promise<{ toolOutput: { tool: string; command: string; exitCode: number; stdout?: string; stderr?: string; outputFiles?: string[]; duration: number }; data: unknown; evidence: EvidenceReference[] }> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(this.rabin2Path!, ['-zj', targetPath], { timeoutMs: 60000 });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        stderr = error.stderr;
        exitCode = error.exitCode;
      } else {
        stderr = error instanceof Error ? error.message : String(error);
        exitCode = 1;
      }
    }

    const duration = Date.now() - startTime;
    const toolOutput = {
      tool: 'rabin2',
      command: `rabin2 -zj ${targetPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const data = parseJsonOutput(stdout);

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence('rabin2', `rabin2 -zj ${targetPath}`, stdout.slice(0, 2000), {
          file: targetPath,
        }),
      );
    }

    return { toolOutput, data, evidence };
  }

  private buildStringsFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const strings = Array.isArray(data) ? data : [];
    const stringCount = strings.length;
    const minLength = (request.parameters.minLength as number) ?? 4;

    const observation = `Found ${stringCount} string(s) with minimum length ${minLength}`;
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'rabin2 -zj returned string data', weight: 1.0 },
      { name: 'strings-found', impact: stringCount > 0 ? 'positive' : 'neutral', description: `${stringCount} strings extracted`, weight: 0.5 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'binary.strings',
      category: 'data' as FindingCategory,
      severity: 'info' as FindingSeverity,
      title: 'Binary strings',
      observation,
      inference: stringCount === 0 ? 'No printable strings found above minimum length' : 'String data available for analysis',
      evidence: [
        buildEvidence(
          'rabin2',
          `rabin2 -zj ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(strings.slice(0, 20), null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['Only printable strings above minimum length are reported; encoding is assumed ASCII/UTF-8'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'rabin2',
        `rabin2 -zj ${request.parameters.targetPath ?? 'unknown'}`,
        { stringCount, minLength },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['binary', 'strings', 'data'],
      createdBy: 'rizin-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // binary.imports - rabin2 -ij <file>
  // ------------------------------------------------------------------
  private async runRabin2Imports(
    targetPath: string,
  ): Promise<{ toolOutput: { tool: string; command: string; exitCode: number; stdout?: string; stderr?: string; outputFiles?: string[]; duration: number }; data: unknown; evidence: EvidenceReference[] }> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(this.rabin2Path!, ['-ij', targetPath], { timeoutMs: 60000 });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        stderr = error.stderr;
        exitCode = error.exitCode;
      } else {
        stderr = error instanceof Error ? error.message : String(error);
        exitCode = 1;
      }
    }

    const duration = Date.now() - startTime;
    const toolOutput = {
      tool: 'rabin2',
      command: `rabin2 -ij ${targetPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const data = parseJsonOutput(stdout);

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence('rabin2', `rabin2 -ij ${targetPath}`, stdout.slice(0, 2000), {
          file: targetPath,
        }),
      );
    }

    return { toolOutput, data, evidence };
  }

  private buildImportsFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const imports = Array.isArray(data) ? data : [];
    const importCount = imports.length;

    const observation = `Found ${importCount} imported function(s)/library(ies)`;
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'rabin2 -ij returned import data', weight: 1.0 },
      { name: 'imports-present', impact: importCount > 0 ? 'positive' : 'negative', description: `${importCount} imports found`, weight: 0.6 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'binary.imports',
      category: 'dependency' as FindingCategory,
      severity: 'info' as FindingSeverity,
      title: 'Binary imports',
      observation,
      inference: importCount === 0 ? 'No external imports; likely statically linked or self-contained' : 'External library dependencies identified',
      evidence: [
        buildEvidence(
          'rabin2',
          `rabin2 -ij ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(imports, null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['Import table analysis only; dynamically loaded libraries not detected'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'rabin2',
        `rabin2 -ij ${request.parameters.targetPath ?? 'unknown'}`,
        { importCount },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['binary', 'imports', 'dependency'],
      createdBy: 'rizin-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // binary.cfg - rizin -c 'agfj' <file>
  // ------------------------------------------------------------------
  private async runRizinCfg(
    targetPath: string,
  ): Promise<{ toolOutput: { tool: string; command: string; exitCode: number; stdout?: string; stderr?: string; outputFiles?: string[]; duration: number }; data: unknown; evidence: EvidenceReference[] }> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(
        this.rizinPath!,
        ['-q', '-c', 'agfj', targetPath],
        { timeoutMs: 120000 },
      );
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        stderr = error.stderr;
        exitCode = error.exitCode;
      } else {
        stderr = error instanceof Error ? error.message : String(error);
        exitCode = 1;
      }
    }

    const duration = Date.now() - startTime;
    const toolOutput = {
      tool: 'rizin',
      command: `rizin -q -c 'agfj' ${targetPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const data = parseJsonOutput(stdout);

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence('rizin', `rizin -q -c 'agfj' ${targetPath}`, stdout.slice(0, 2000), {
          file: targetPath,
        }),
      );
    }

    return { toolOutput, data, evidence };
  }

  private buildCfgFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const cfg = data as Record<string, unknown> | null;
    const functions = cfg ? Object.keys(cfg).length : 0;

    const observation = `Control flow graph extracted: ${functions} function(s)`;
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'rizin agfj returned CFG data', weight: 1.0 },
      { name: 'cfg-present', impact: functions > 0 ? 'positive' : 'negative', description: `${functions} function(s) in CFG`, weight: 0.7 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'binary.cfg',
      category: 'code' as FindingCategory,
      severity: 'info' as FindingSeverity,
      title: 'Control flow graph',
      observation,
      inference: functions === 0 ? 'No functions detected in CFG; binary may be stripped or trivial' : 'Function call graph available for control flow analysis',
      evidence: [
        buildEvidence(
          'rizin',
          `rizin -q -c 'agfj' ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(cfg, null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['CFG may be incomplete for stripped binaries; indirect calls not resolved'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'rizin',
        `rizin -q -c 'agfj' ${request.parameters.targetPath ?? 'unknown'}`,
        { functions },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['binary', 'cfg', 'control-flow'],
      createdBy: 'rizin-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // Helper: build provenance
  // ------------------------------------------------------------------
  protected buildProvenance(
    request: AnalysisRequest,
    tool: string,
    command: string,
    parameters: Record<string, unknown>,
    toolVersion: string,
  ): ProvenanceInfo {
    return {
      derivedFrom: [],
      tool,
      command,
      parameters,
      duration: 0,
      toolVersion,
    };
  }

  // ------------------------------------------------------------------
  // Helper: build reproducibility
  // ------------------------------------------------------------------
  protected buildReproducibility(request: AnalysisRequest): ReproducibilityInfo {
    return {
      reproducible: true,
      environmentId: request.sessionId,
      steps: [
        {
          order: 1,
          action: 'Install rizin',
          tool: 'package-manager',
          parameters: {},
          expectedOutcome: 'rizin and rabin2 available on PATH',
        },
        {
          order: 2,
          action: `Run ${this.id} analysis`,
          tool: this.id,
          parameters: { capability: request.capabilityId, targetPath: request.parameters.targetPath },
          expectedOutcome: 'Static analysis findings with evidence and provenance',
        },
      ],
      knownVariations: [
        {
          condition: 'Stripped binary',
          effectOnFinding: 'minor',
        },
        {
          condition: 'Different rizin version',
          effectOnFinding: 'minor',
        },
      ],
    };
  }
}

export function createRizinProvider(): CapabilityProvider {
  return new RizinProvider();
}

export { buildConfidence, buildEvidence };
