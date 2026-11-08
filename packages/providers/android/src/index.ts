/**
 * Android analysis provider.
 *
 * Implements static APK analysis using apktool, JADX, aapt2, and apksigner.
 * All external tool execution uses safe subprocess spawning with argument
 * arrays (never shell: true), timeouts, output limits, and proper error
 * handling. Analyzed APKs are never executed.
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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '@sre-studio/shared';
import { ProviderError, ToolExecutionError } from '@sre-studio/shared';

const logger = createLogger('android-provider');

const PROVIDER_ID = 'android';
const PROVIDER_NAME = 'Android APK Provider';
const PROVIDER_VERSION = '0.1.0';

const REQUIRED_TOOLS: ReadonlyArray<ExternalToolDependency> = [
  {
    name: 'apktool',
    versionConstraint: '>=2.7.0',
    verifyCommand: 'apktool --version',
    installHint: {
      win32: 'Download apktool from https://ibotpeaches.github.io/Apktool/ and add to PATH',
      darwin: 'brew install apktool',
      linux: 'apt install apktool or download from https://ibotpeaches.github.io/Apktool/',
    },
  },
  {
    name: 'jadx',
    versionConstraint: '>=1.3.0',
    verifyCommand: 'jadx --version',
    installHint: {
      win32: 'Download JADX from https://github.com/skylot/jadx/releases and add to PATH',
      darwin: 'brew install jadx',
      linux: 'Download from https://github.com/skylot/jadx/releases',
    },
    optional: true,
  },
  {
    name: 'aapt2',
    versionConstraint: '>=4.0.0',
    verifyCommand: 'aapt2 version',
    installHint: {
      win32: 'Install Android SDK Build-Tools and add aapt2 to PATH',
      darwin: 'Install Android SDK Build-Tools',
      linux: 'Install android-sdk-build-tools',
    },
    optional: true,
  },
  {
    name: 'apksigner',
    versionConstraint: '>=4.0.0',
    verifyCommand: 'apksigner --version',
    installHint: {
      win32: 'Install Android SDK Build-Tools and add apksigner to PATH',
      darwin: 'Install Android SDK Build-Tools',
      linux: 'Install android-sdk-build-tools',
    },
    optional: true,
  },
];

const CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  {
    id: 'android.manifest',
    name: 'Android Manifest',
    description: 'Parsed AndroidManifest.xml (package, permissions, components, minSdk)',
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
    id: 'android.permissions',
    name: 'Android Permissions',
    description: 'Declared permissions from aapt2 or manifest',
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
    id: 'android.resources',
    name: 'Android Resources',
    description: 'Resource directory inventory from apktool decompile',
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
    id: 'android.dex',
    name: 'Android DEX',
    description: 'DEX summary from JADX decompilation',
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
  {
    id: 'android.signing',
    name: 'Android Signing',
    description: 'APK signing certificate chain from apksigner',
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
      fs.statSync(configuredPath);
      return configuredPath;
    } catch {
      // Fall through
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
    const localAppData = process.env['LOCALAPPDATA'] as string | undefined;
    const userProfile = process.env['USERPROFILE'] as string | undefined;
    const commonDirs = [
      'C:\\Android\\SDK\\build-tools\\latest',
      localAppData ? path.join(localAppData, 'Android', 'Sdk', 'build-tools') : '',
      userProfile ? path.join(userProfile, 'Android', 'Sdk', 'build-tools') : '',
    ];
    const exeName = `${toolName}.exe`;
    for (const dir of commonDirs) {
      if (!dir) continue;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const full = path.join(dir, entry.name, exeName);
            try {
              fs.statSync(full);
              return full;
            } catch {
              // Continue
            }
          }
        }
      } catch {
        // Continue
      }
    }
    for (const dir of commonDirs) {
      const full = path.join(dir, exeName);
      try {
        fs.statSync(full);
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
  const timeoutMs = options.timeoutMs ?? 300000;
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
 * Parses JSON output from a tool.
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
 * Parses XML content into a simple object structure.
 */
function parseSimpleXml(xml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Match self-closing tags FIRST: <tag attr="val" />
  const selfClosingRegex = /<([a-zA-Z][a-zA-Z0-9_-]*)([^>]*)\/>/g;
  // Match regular tags: <tag attr="val">content</tag>
  const tagRegex = /<([a-zA-Z][a-zA-Z0-9_-]*)([^>]*)>([\s\S]*?)<\/\1>/g;

  const processMatch = (tagName: string, attrsStr: string, content: string) => {
    const attrs: Record<string, string> = {};
    const attrRegex = /([a-zA-Z][a-zA-Z0-9_:-]*)="([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      let attrName = attrMatch[1];
      const colonIdx = attrName.indexOf(':');
      if (colonIdx >= 0) {
        attrName = attrName.substring(colonIdx + 1);
      }
      attrs[attrName] = attrMatch[2];
    }
    if (!(result[tagName] instanceof Array)) {
      result[tagName] = [];
    }
    (result[tagName] as Array<unknown>).push({ ...attrs, _content: content.trim() });
  };

  let match: RegExpExecArray | null;
  while ((match = selfClosingRegex.exec(xml)) !== null) {
    processMatch(match[1], match[2], '');
  }
  while ((match = tagRegex.exec(xml)) !== null) {
    processMatch(match[1], match[2], match[3]);
  }

  return result;
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
      .join('; ') || 'Static APK analysis via Android toolchain',
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

export class AndroidProvider extends BaseProvider {
  readonly id = PROVIDER_ID;
  readonly name = PROVIDER_NAME;
  readonly version = PROVIDER_VERSION;
  readonly description = 'Static Android APK analysis via apktool, JADX, aapt2, apksigner';

  readonly capabilities: ReadonlyArray<ProviderCapability> = CAPABILITIES;
  readonly requiredTools: ReadonlyArray<ExternalToolDependency> = REQUIRED_TOOLS;

  private apktoolPath: string | undefined;
  private jadxPath: string | undefined;
  private aapt2Path: string | undefined;
  private apksignerPath: string | undefined;

  override async initialize(config: ProviderConfig): Promise<InitializationResult> {
    this.config = config;

    this.apktoolPath = discoverTool('apktool', (config.toolPaths as Record<string, string> | undefined)?.apktool);
    this.jadxPath = discoverTool('jadx', (config.toolPaths as Record<string, string> | undefined)?.jadx);
    this.aapt2Path = discoverTool('aapt2', (config.toolPaths as Record<string, string> | undefined)?.aapt2);
    this.apksignerPath = discoverTool('apksigner', (config.toolPaths as Record<string, string> | undefined)?.apksigner);

    const coreAvailable = !!this.apktoolPath;
    logger.info({
      providerId: this.id,
      apktoolPath: this.apktoolPath,
      jadxPath: this.jadxPath,
      aapt2Path: this.aapt2Path,
      apksignerPath: this.apksignerPath,
      coreAvailable,
    }, 'Android provider initialized');

    return {
      success: true,
      message: coreAvailable
        ? 'Android provider initialized with core tools available'
        : 'Android provider initialized but apktool not found on PATH',
      availableCapabilities: coreAvailable
        ? this.capabilities.map((c) => c.id)
        : [],
    };
  }

  override async doInitialize(): Promise<InitializationResult> {
    return {
      success: true,
      message: 'Android provider initialized',
      availableCapabilities: !!this.apktoolPath ? this.capabilities.map((c) => c.id) : [],
    };
  }

  override async validateEnvironment(): Promise<EnvironmentValidationResult> {
    const availableTools: string[] = [];
    const missingTools: string[] = [];
    const warnings: string[] = [];

    const allTools = [
      { name: 'apktool', path: this.apktoolPath, optional: false },
      { name: 'jadx', path: this.jadxPath, optional: true },
      { name: 'aapt2', path: this.aapt2Path, optional: true },
      { name: 'apksigner', path: this.apksignerPath, optional: true },
    ];

    for (const t of allTools) {
      if (t.path) {
        availableTools.push(t.name);
      } else if (t.optional) {
        warnings.push(`Optional tool missing: ${t.name}`);
      } else {
        missingTools.push(t.name);
        warnings.push(`Required tool missing: ${t.name}`);
      }
    }

    return {
      valid: missingTools.length === 0,
      availableTools,
      missingTools,
      warnings,
    };
  }

  override async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const validation = await this.validateEnvironment();
    if (!validation.valid) {
      throw new ProviderError(
        `Android tools not available: ${validation.missingTools.join(', ')}`,
        this.id,
        { missingTools: validation.missingTools },
        false,
      );
    }
    return super.analyze(request);
  }

  override async doAnalyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();

    const contextPath = (request.context as Record<string, unknown> | undefined)?.targetPath as string | undefined;
    const paramPath = request.parameters.targetPath as string | undefined;
    const targetPath = contextPath ?? paramPath ?? '';

    if (!targetPath) {
      throw new Error('Target path is required for Android analysis');
    }

    let targetExists = false;
    try {
      fs.statSync(targetPath);
      targetExists = true;
    } catch {
      // File doesn't exist
    }
    if (!targetExists) {
      throw new Error(`Target APK not found: ${targetPath}`);
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

    const addFinding = (finding: Finding) => {
      findings.push(finding);
      findingsByCategory[finding.category] = (findingsByCategory[finding.category] || 0) + 1;
      findingsBySeverity[finding.severity] = (findingsBySeverity[finding.severity] || 0) + 1;
    };
    const addToolOutput = (output: {
      tool: string;
      command: string;
      exitCode: number;
      stdout?: string;
      stderr?: string;
      outputFiles?: string[];
      duration: number;
    }) => {
      toolOutputs.push(output);
    };

    // Decompile APK once for capabilities that need the extracted content
    let decompileDir: string | undefined;
    let manifestXml: string | undefined;

    try {
      if (
        request.capabilityId === 'android.manifest' ||
        request.capabilityId === 'android.permissions' ||
        request.capabilityId === 'android.resources' ||
        request.capabilityId === ''
      ) {
        const decompileResult = await this.decompileApk(targetPath);
        decompileDir = decompileResult.decompileDir;
        addToolOutput(decompileResult.toolOutput);
        evidenceCount += decompileResult.evidence.length;

        const manifestPath = path.join(decompileResult.decompileDir, 'AndroidManifest.xml');
        try {
          manifestXml = fs.readFileSync(manifestPath, 'utf-8');
        } catch {
          manifestXml = undefined;
        }
      }
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        errors.push({
          code: 'TOOL_EXECUTION_ERROR',
          message: error.message,
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

    // --- android.manifest ---
    if (
      (request.capabilityId === 'android.manifest' || request.capabilityId === '') &&
      manifestXml
    ) {
      const manifestFinding = this.buildManifestFinding(request, manifestXml, toolVersion);
      addFinding(manifestFinding);
    }

    // --- android.permissions ---
    if (
      (request.capabilityId === 'android.permissions' || request.capabilityId === '') &&
      this.aapt2Path
    ) {
      try {
        const permsResult = await this.runAapt2Permissions(targetPath);
        addToolOutput(permsResult.toolOutput);
        evidenceCount += permsResult.evidence.length;
        const permsFinding = this.buildPermissionsFinding(request, permsResult.data, toolVersion);
        addFinding(permsFinding);
      } catch (error) {
        warnings.push(`Permissions analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // --- android.resources ---
    if (
      (request.capabilityId === 'android.resources' || request.capabilityId === '') &&
      decompileDir
    ) {
      try {
        const resResult = await this.scanResources(decompileDir);
        addToolOutput(resResult.toolOutput);
        evidenceCount += resResult.evidence.length;
        const resFinding = this.buildResourcesFinding(request, resResult.data, toolVersion);
        addFinding(resFinding);
      } catch (error) {
        warnings.push(`Resources analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // --- android.dex ---
    if (
      (request.capabilityId === 'android.dex' || request.capabilityId === '') &&
      this.jadxPath
    ) {
      try {
        const dexResult = await this.runJadx(targetPath);
        addToolOutput(dexResult.toolOutput);
        evidenceCount += dexResult.evidence.length;
        const dexFinding = this.buildDexFinding(request, dexResult.data, toolVersion);
        addFinding(dexFinding);
      } catch (error) {
        warnings.push(`DEX analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // --- android.signing ---
    if (
      (request.capabilityId === 'android.signing' || request.capabilityId === '') &&
      this.apksignerPath
    ) {
      try {
        const signingResult = await this.runApksigner(targetPath);
        addToolOutput(signingResult.toolOutput);
        evidenceCount += signingResult.evidence.length;
        const signingFinding = this.buildSigningFinding(request, signingResult.data, toolVersion);
        addFinding(signingFinding);
      } catch (error) {
        warnings.push(`Signing analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Cleanup decompile directory
    if (decompileDir) {
      try {
        fs.rmSync(decompileDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    const duration = Date.now() - startTime;
    const avgConfidence =
      findings.length > 0
        ? findings.reduce((sum, f) => sum + f.confidence.value, 0) / findings.length
        : 0;

    return {
      findings,
      summary: `Android APK analysis of ${targetPath}: ${findings.length} finding(s) across ${Object.keys(findingsByCategory).length} category(ies)`,
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
    logger.info({ providerId: this.id }, 'Android provider shutdown');
  }

  // =====================================================================
  // Helper methods
  // =====================================================================

  private async getToolVersion(): Promise<string> {
    if (this.apktoolPath) {
      try {
        const result = spawnSync(this.apktoolPath, ['--version'], {
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
    }
    return 'unknown';
  }

  private async decompileApk(
    apkPath: string,
  ): Promise<{
    decompileDir: string;
    toolOutput: {
      tool: string;
      command: string;
      exitCode: number;
      stdout?: string;
      stderr?: string;
      outputFiles?: string[];
      duration: number;
    };
    evidence: EvidenceReference[];
  }> {
    const decompileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sre-android-'));
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(
        this.apktoolPath!,
        ['d', '-f', '-o', decompileDir, apkPath],
        { timeoutMs: 300000 },
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
      try {
        fs.rmSync(decompileDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
      throw error;
    }

    const duration = Date.now() - startTime;
    const toolOutput = {
      tool: 'apktool',
      command: `apktool d -f -o ${decompileDir} ${apkPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence(
          'apktool',
          `apktool d -f -o ${decompileDir} ${apkPath}`,
          stdout.slice(0, 2000),
          { file: apkPath },
        ),
      );
    }

    return { decompileDir, toolOutput, evidence };
  }

  // ------------------------------------------------------------------
  // android.manifest
  // ------------------------------------------------------------------
  private buildManifestFinding(
    request: AnalysisRequest,
    manifestXml: string,
    toolVersion: string,
  ): Finding {
    const parsed = parseSimpleXml(manifestXml);
    const manifestTag = (parsed.manifest as Array<unknown> | undefined)?.[0] as Record<string, unknown> | undefined;
    const packageName = (manifestTag && (manifestTag['package'] as string)) ?? 'unknown';
    const usesSdk = (parsed['uses-sdk'] as Array<unknown> | undefined)?.[0] as Record<string, unknown> | undefined;
    const minSdk = (usesSdk && (usesSdk['minSdkVersion'] as string)) ?? 'unknown';
    const targetSdk = (usesSdk && (usesSdk['targetSdkVersion'] as string)) ?? 'unknown';

    const permissions = (parsed['uses-permission'] as Array<unknown> | undefined) ?? [];
    const permissionCount = permissions.length;
    const components = [
      ...((parsed['activity'] as Array<unknown> | undefined) ?? []),
      ...((parsed['service'] as Array<unknown> | undefined) ?? []),
      ...((parsed['receiver'] as Array<unknown> | undefined) ?? []),
      ...((parsed['provider'] as Array<unknown> | undefined) ?? []),
    ].length;

    const observation = `Package: ${packageName}, minSdk: ${minSdk}, targetSdk: ${targetSdk}, ${permissionCount} permission(s), ${components} component(s)`;
    const factors: ConfidenceFactor[] = [
      { name: 'manifest-parsed', impact: 'positive', description: 'AndroidManifest.xml parsed successfully', weight: 1.0 },
      { name: 'package-name', impact: packageName !== 'unknown' ? 'positive' : 'negative', description: `Package ${packageName} identified`, weight: 0.5 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'android.manifest',
      category: 'configuration' as FindingCategory,
      severity: 'info' as FindingSeverity,
      title: 'Android manifest',
      observation,
      inference: `APK package ${packageName} targeting SDK ${targetSdk} (min ${minSdk})`,
      evidence: [
        buildEvidence(
          'apktool',
          `apktool d -f -o <dir> ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          manifestXml.slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['Manifest values are declared, not verified at runtime'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'apktool',
        `apktool d ${request.parameters.targetPath ?? 'unknown'}`,
        { packageName, minSdk, targetSdk, permissionCount, components },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['android', 'manifest', packageName],
      createdBy: 'android-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // android.permissions - aapt2 dump permissions <apk>
  // ------------------------------------------------------------------
  private async runAapt2Permissions(
    apkPath: string,
  ): Promise<{
    toolOutput: {
      tool: string;
      command: string;
      exitCode: number;
      stdout?: string;
      stderr?: string;
      outputFiles?: string[];
      duration: number;
    };
    data: string[];
    evidence: EvidenceReference[];
  }> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(
        this.aapt2Path!,
        ['dump', 'permissions', apkPath],
        { timeoutMs: 60000 },
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
      tool: 'aapt2',
      command: `aapt2 dump permissions ${apkPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const permissions: string[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('permission:')) {
        const perm = trimmed.substring('permission:'.length).trim();
        if (perm) permissions.push(perm);
      }
    }

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence('aapt2', `aapt2 dump permissions ${apkPath}`, stdout.slice(0, 2000), {
          file: apkPath,
        }),
      );
    }

    return { toolOutput, data: permissions, evidence };
  }

  private buildPermissionsFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const permissions = Array.isArray(data) ? data : [];
    const permissionCount = permissions.length;
    const dangerousPerms = permissions.filter((p: string) =>
      p.includes('CAMERA') ||
      p.includes('MICROPHONE') ||
      p.includes('LOCATION') ||
      p.includes('CONTACTS') ||
      p.includes('SMS') ||
      p.includes('PHONE') ||
      p.includes('STORAGE') ||
      p.includes('LOCATION'),
    ).length;

    const observation = `Declared ${permissionCount} permission(s), ${dangerousPerms} potentially sensitive`;
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'aapt2 dump permissions returned data', weight: 1.0 },
      { name: 'permissions-declared', impact: permissionCount > 0 ? 'positive' : 'neutral', description: `${permissionCount} permissions declared`, weight: 0.5 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'android.permissions',
      category: 'configuration' as FindingCategory,
      severity: dangerousPerms > 3 ? 'medium' : 'info' as FindingSeverity,
      title: 'Android permissions',
      observation,
      inference: dangerousPerms > 0 ? `App requests ${dangerousPerms} sensitive permission(s)` : 'No sensitive permissions detected',
      evidence: [
        buildEvidence(
          'aapt2',
          `aapt2 dump permissions ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(permissions, null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['Declared permissions only; runtime usage not verified'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'aapt2',
        `aapt2 dump permissions ${request.parameters.targetPath ?? 'unknown'}`,
        { permissionCount, dangerousPerms },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['android', 'permissions', 'security'],
      createdBy: 'android-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // android.resources
  // ------------------------------------------------------------------
  private async scanResources(
    decompileDir: string,
  ): Promise<{
    toolOutput: {
      tool: string;
      command: string;
      exitCode: number;
      stdout?: string;
      stderr?: string;
      outputFiles?: string[];
      duration: number;
    };
    data: Record<string, number>;
    evidence: EvidenceReference[];
  }> {
    const startTime = Date.now();
    const resources: Record<string, number> = {};

    const scanDir = (dir: string, prefix: string = '') => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = prefix + entry.name;
          if (entry.isDirectory()) {
            scanDir(fullPath, relPath + '/');
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            const key = ext || '(no extension)';
            resources[key] = (resources[key] ?? 0) + 1;
          }
        }
      } catch {
        // Ignore
      }
    };

    const resDir = path.join(decompileDir, 'res');
    scanDir(resDir);

    const duration = Date.now() - startTime;
    const totalFiles = Object.values(resources).reduce((a, b) => a + b, 0);

    const toolOutput = {
      tool: 'apktool',
      command: `apktool d (resource scan) ${decompileDir}`,
      exitCode: 0,
      stdout: JSON.stringify(resources, null, 2),
      duration,
    };

    const evidence: EvidenceReference[] = [
      buildEvidence('apktool', `apktool d -f -o ${decompileDir}`, `Resources: ${JSON.stringify(resources)}`, {
        file: decompileDir,
      }),
    ];

    return { toolOutput, data: resources, evidence };
  }

  private buildResourcesFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const resources = (data as Record<string, number>) ?? {};
    const totalFiles = Object.values(resources).reduce((a, b) => a + b, 0);
    const resourceTypes = Object.keys(resources).length;

    const observation = `Resource directory contains ${totalFiles} file(s) across ${resourceTypes} type(s)`;
    const factors: ConfidenceFactor[] = [
      { name: 'resources-found', impact: totalFiles > 0 ? 'positive' : 'neutral', description: `${totalFiles} resource files`, weight: 0.6 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'android.resources',
      category: 'data' as FindingCategory,
      severity: 'info' as FindingSeverity,
      title: 'Android resources',
      observation,
      inference: totalFiles === 0 ? 'No resources found; possibly minimal APK' : 'Resource inventory available',
      evidence: [
        buildEvidence(
          'apktool',
          `apktool d ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(resources, null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['Resource inventory only; content of resources not analyzed'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'apktool',
        `apktool d ${request.parameters.targetPath ?? 'unknown'}`,
        { totalFiles, resourceTypes },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['android', 'resources'],
      createdBy: 'android-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // android.dex - JADX
  // ------------------------------------------------------------------
  private async runJadx(
    apkPath: string,
  ): Promise<{
    toolOutput: {
      tool: string;
      command: string;
      exitCode: number;
      stdout?: string;
      stderr?: string;
      outputFiles?: string[];
      duration: number;
    };
    data: Record<string, unknown>;
    evidence: EvidenceReference[];
  }> {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sre-jadx-'));
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(
        this.jadxPath!,
        ['-d', outputDir, '--export-gradle', apkPath],
        { timeoutMs: 300000 },
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
      try {
        fs.rmSync(outputDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
      throw error;
    }

    const duration = Date.now() - startTime;
    const toolOutput = {
      tool: 'jadx',
      command: `jadx -d ${outputDir} --export-gradle ${apkPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const data: Record<string, unknown> = {
      outputDir,
      classesDex: fs.existsSync(path.join(outputDir, 'classes.dex')),
    };

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence('jadx', `jadx -d ${outputDir} --export-gradle ${apkPath}`, stdout.slice(0, 2000), {
          file: apkPath,
        }),
      );
    }

    try {
      fs.rmSync(outputDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    return { toolOutput, data, evidence };
  }

  private buildDexFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const dexData = data as Record<string, unknown>;
    const hasClassesDex = (dexData.classesDex as boolean) ?? false;

    const observation = hasClassesDex ? 'classes.dex found after JADX decompilation' : 'DEX analysis completed';
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'JADX decompilation completed', weight: 1.0 },
      { name: 'dex-present', impact: hasClassesDex ? 'positive' : 'negative', description: 'classes.dex present', weight: 0.5 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'android.dex',
      category: 'code' as FindingCategory,
      severity: 'info' as FindingSeverity,
      title: 'Android DEX',
      observation,
      inference: hasClassesDex ? 'DEX bytecode available for analysis' : 'No DEX bytecode extracted',
      evidence: [
        buildEvidence(
          'jadx',
          `jadx -d <dir> --export-gradle ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(dexData, null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['JADX decompilation summary only; full decompiled source not analyzed'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'jadx',
        `jadx -d <dir> --export-gradle ${request.parameters.targetPath ?? 'unknown'}`,
        { hasClassesDex },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['android', 'dex', 'jadx'],
      createdBy: 'android-provider',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // android.signing - apksigner verify --print-certs
  // ------------------------------------------------------------------
  private async runApksigner(
    apkPath: string,
  ): Promise<{
    toolOutput: {
      tool: string;
      command: string;
      exitCode: number;
      stdout?: string;
      stderr?: string;
      outputFiles?: string[];
      duration: number;
    };
    data: Record<string, unknown>;
    evidence: EvidenceReference[];
  }> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 1;

    try {
      const result = execToolSafe(
        this.apksignerPath!,
        ['verify', '--print-certs', apkPath],
        { timeoutMs: 60000 },
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
      tool: 'apksigner',
      command: `apksigner verify --print-certs ${apkPath}`,
      exitCode,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      duration,
    };

    const data: Record<string, unknown> = {
      signed: exitCode === 0,
      certificateInfo: stdout.slice(0, 5000),
    };

    const evidence: EvidenceReference[] = [];
    if (stdout) {
      evidence.push(
        buildEvidence('apksigner', `apksigner verify --print-certs ${apkPath}`, stdout.slice(0, 2000), {
          file: apkPath,
        }),
      );
    }

    return { toolOutput, data, evidence };
  }

  private buildSigningFinding(
    request: AnalysisRequest,
    data: unknown,
    toolVersion: string,
  ): Finding {
    const signingData = data as Record<string, unknown>;
    const signed = (signingData.signed as boolean) ?? false;

    const observation = signed ? 'APK is signed' : 'APK is not signed or signature verification failed';
    const factors: ConfidenceFactor[] = [
      { name: 'tool-exit-code', impact: 'positive', description: 'apksigner verify completed', weight: 1.0 },
      { name: 'apk-signed', impact: signed ? 'positive' : 'negative', description: signed ? 'APK has valid signature' : 'APK signature verification failed', weight: 0.8 },
    ];

    return {
      id: '',
      sessionId: request.sessionId,
      targetId: request.targetId,
      providerId: this.id,
      capabilityId: 'android.signing',
      category: 'security' as FindingCategory,
      severity: signed ? 'info' : 'low' as FindingSeverity,
      title: 'Android signing',
      observation,
      inference: signed ? 'APK is signed with a certificate' : 'APK is unsigned - may not install on some devices',
      evidence: [
        buildEvidence(
          'apksigner',
          `apksigner verify --print-certs ${(request.parameters.targetPath as string) ?? 'unknown'}`,
          JSON.stringify(signingData.certificateInfo, null, 2).slice(0, 2000),
          { file: (request.parameters.targetPath as string) ?? 'unknown' },
        ),
      ],
      confidence: buildConfidence(factors),
      limitations: ['Certificate chain not fully validated; only signature presence checked'],
      unknowns: [],
      provenance: this.buildProvenance(
        request,
        'apksigner',
        `apksigner verify --print-certs ${request.parameters.targetPath ?? 'unknown'}`,
        { signed },
        toolVersion,
      ),
      reproducibility: this.buildReproducibility(request),
      tags: ['android', 'signing', 'security'],
      createdBy: 'android-provider',
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
          action: 'Install Android SDK Build-Tools, apktool, and JADX',
          tool: 'package-manager',
          parameters: {},
          expectedOutcome: 'apktool, jadx, aapt2, apksigner available on PATH',
        },
        {
          order: 2,
          action: `Run ${this.id} analysis`,
          tool: this.id,
          parameters: { capability: request.capabilityId, targetPath: request.parameters.targetPath },
          expectedOutcome: 'Static APK analysis findings with evidence and provenance',
        },
      ],
      knownVariations: [
        {
          condition: 'Different APK version',
          effectOnFinding: 'major',
        },
        {
          condition: 'Proguard/R8 obfuscation',
          effectOnFinding: 'major',
        },
      ],
    };
  }
}

export function createAndroidProvider(): CapabilityProvider {
  return new AndroidProvider();
}

export { buildConfidence, buildEvidence, parseSimpleXml };
