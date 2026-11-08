import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepository, createSessionManager, createEvidenceEngine } from '@sre-studio/core';
import { createProjectConfig } from '../src/config/project.js';
import { createProgram } from '../src/index.js';

describe('report CLI command', () => {
  let tempDir: string;
  let originalCwd: string;
  let dbPath: string;
  let testSessionId: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sre-cli-report-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    dbPath = path.join(tempDir, '.sre-studio', 'investigation.db');

    // Create project config
    await createProjectConfig(tempDir, {
      name: 'report-test-project',
      projectId: 'proj_report_test',
      targetType: 'binary',
      targetPath: path.join(tempDir, 'dummy.exe'),
      authorization: {
        type: 'owner',
        description: 'Test authorization for report suite',
        scope: [path.join(tempDir, 'dummy.exe')],
        limitations: ['test only'],
      },
    });

    // Set up database and session
    const repo = createRepository({ dbPath });
    try {
      const evidenceEngine = createEvidenceEngine({ repository: repo });
      const sessionManager = createSessionManager({
        repository: repo,
        evidenceEngine,
        defaultResourceLimits: { maxMemoryMb: 2048, maxCpuPercent: 80, maxDurationMs: 60000 },
      });

      const authRecord = {
        type: 'owner' as const,
        description: 'Test authorization for report suite',
        scope: [path.join(tempDir, 'dummy.exe')],
        limitations: [],
        verified: true,
      };

      const session = await sessionManager.createSession({
        projectId: 'proj_report_test',
        name: 'Test Report Investigation',
        description: 'Session for testing report CLI outputs',
        createdBy: 'analyst',
        authorization: authRecord,
      });
      testSessionId = session.id;

      const target = sessionManager.registerTarget(testSessionId, {
        type: 'binary',
        path: path.join(tempDir, 'dummy.exe'),
        role: 'primary',
        metadata: { format: 'pe', architecture: 'x86_64' },
        hashes: { sha256: 'a'.repeat(64) },
        authorization: authRecord,
      });

      // Record test environment
      const env = sessionManager.getOrCreateEnvironment(testSessionId, 'a'.repeat(64));

      // Record test finding
      evidenceEngine.createFinding({
        sessionId: testSessionId,
        targetId: target.id,
        providerId: 'rizin',
        capabilityId: 'binary.decompile',
        category: 'code',
        severity: 'high',
        confidence: {
          level: 'high',
          value: 0.95,
          justification: 'Clear decompiled strcpy without destination buffer bounds check',
          factors: [],
        },
        title: 'Insecure Memory Copy Vulnerability',
        observation: 'strcpy call with unchecked user input buffer',
        description: 'Use of strcpy without bounds checking in sub_401000',
        evidence: [],
        limitations: [],
        unknowns: [],
        tags: ['cve', 'buffer-overflow'],
        createdBy: 'analyst',
        provenance: {
          tool: 'rizin',
          version: '0.7.0',
          capability: 'decompilation',
          timestamp: new Date().toISOString(),
          parameters: {},
          exitCode: 0,
        },
        reproducibility: {
          reproducible: true,
          steps: ['Disassemble sub_401000', 'Check strcpy call'],
          environmentId: env.id,
        },
      });
    } finally {
      repo.close();
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates a technical markdown report to stdout', async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        'node',
        'sre-studio',
        'report',
        testSessionId,
        '--format',
        'markdown',
        '--template',
        'technical',
      ])
    ).resolves.not.toThrow();
  });

  it('generates a JSON report saved to file with --output', async () => {
    const program = createProgram();
    program.exitOverride();

    const outputPath = path.join(tempDir, 'report.json');
    await program.parseAsync([
      'node',
      'sre-studio',
      'report',
      testSessionId,
      '--format',
      'json',
      '--output',
      outputPath,
    ]);

    expect(existsSync(outputPath)).toBe(true);
    const content = JSON.parse(readFileSync(outputPath, 'utf-8'));
    expect(content.session.id).toBe(testSessionId);
    expect(content.statistics.findingsByCategory).toBeDefined();
    expect(content.findings).toHaveLength(1);
    expect(content.findings[0].title).toBe('Insecure Memory Copy Vulnerability');
    expect(content.findings[0].severity).toBe('high');
  });

  it('generates an executive markdown report with severity summaries', async () => {
    const program = createProgram();
    program.exitOverride();

    const outputPath = path.join(tempDir, 'executive.md');
    await program.parseAsync([
      'node',
      'sre-studio',
      'report',
      testSessionId,
      '--template',
      'executive',
      '--output',
      outputPath,
    ]);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('Executive Summary');
    expect(content).toContain('Findings by Severity');
    expect(content).toContain('`executive`');
    expect(content).toContain('high');
  });

  it('generates a compliance markdown report', async () => {
    const program = createProgram();
    program.exitOverride();

    const outputPath = path.join(tempDir, 'compliance.md');
    await program.parseAsync([
      'node',
      'sre-studio',
      'report',
      testSessionId,
      '--template',
      'compliance',
      '--output',
      outputPath,
    ]);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('`compliance`');
    expect(content).toContain('Session ID');
    expect(content).toContain('Average Confidence');
    expect(content).toContain('Insecure Memory Copy Vulnerability');
  });

  it('generates an HTML report', async () => {
    const program = createProgram();
    program.exitOverride();

    const outputPath = path.join(tempDir, 'report.html');
    await program.parseAsync([
      'node',
      'sre-studio',
      'report',
      testSessionId,
      '--format',
      'html',
      '--output',
      outputPath,
    ]);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('Test Report Investigation');
    expect(content).toContain('Insecure Memory Copy Vulnerability');
  });

  it('generates a valid SARIF 2.1.0 report', async () => {
    const program = createProgram();
    program.exitOverride();

    const outputPath = path.join(tempDir, 'report.sarif');
    await program.parseAsync([
      'node',
      'sre-studio',
      'report',
      testSessionId,
      '--format',
      'sarif',
      '--output',
      outputPath,
    ]);

    expect(existsSync(outputPath)).toBe(true);
    const sarif = JSON.parse(readFileSync(outputPath, 'utf-8'));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('sre-studio');
    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0].message.text).toBe('strcpy call with unchecked user input buffer');
    expect(sarif.runs[0].results[0].level).toBe('error');
  });

  it('generates Markdown, HTML, JSON, and SARIF reports containing 1,000 findings with evidence and metadata', async () => {
    // Populate an additional 1,000 findings in SQLite
    const repo = createRepository({ dbPath });
    try {
      const evidenceEngine = createEvidenceEngine({ repository: repo });
      const target = repo.getTargetsBySession(testSessionId)[0]!;
      const env = repo.getOrCreateEnvironment(testSessionId, target.hashes.sha256);

      const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
      const categories = ['binary.structure', 'android.manifest', 'security.crypto', 'antidebug', 'api.telemetry'];

      for (let i = 0; i < 1000; i++) {
        evidenceEngine.createFinding({
          sessionId: testSessionId,
          targetId: target.id,
          providerId: 'test-provider',
          capabilityId: `${categories[i % categories.length]}.inspect`,
          title: `Finding #${i}: Detailed security pattern in ${categories[i % categories.length]}`,
          observation: `Static pattern inspection identified observation block #${i}`,
          inference: `Inference for pattern #${i} suggests validation`,
          category: categories[i % categories.length]!,
          severity: severities[i % severities.length]!,
          confidence: {
            value: 0.85,
            score: 0.85,
            level: 'high',
            justification: `Static pattern match #${i} verified against rule set`,
            factors: [{ factor: 'Static rule', weight: 1.0, contribution: 0.85 }],
          },
          reproducibility: {
            reproducible: true,
            environmentId: env.id,
            steps: [{ order: 1, action: 'Static disassembly', tool: 'test-tool', parameters: {}, expectedOutcome: 'Deterministic' }],
          },
          evidence: [
            {
              type: 'disassembly',
              location: { file: 'dummy.exe', line: i + 1, column: 1 },
              excerpt: `0x${(i * 16).toString(16).padStart(8, '0')}: mov eax, [ebp-${i}]`,
            },
          ],
          provenance: {
            tool: 'test-tool',
            command: 'analyze --all',
            duration: 15,
            toolVersion: '1.0.0',
            derivedFrom: [],
          },
          limitations: ['Static analysis only'],
          unknowns: ['Runtime branch coverage'],
          tags: ['test', 'bulk', categories[i % categories.length]!],
          createdBy: 'test-runner',
        });
      }
    } finally {
      repo.close();
    }

    const program = createProgram();
    program.exitOverride();

    // 1. Markdown Report with Evidence
    const mdPath = path.join(tempDir, 'large-report.md');
    await program.parseAsync([
      'node',
      'sre-studio',
      'report',
      testSessionId,
      '--format',
      'markdown',
      '--template',
      'technical',
      '--include-evidence',
      '--output',
      mdPath,
    ]);
    expect(existsSync(mdPath)).toBe(true);
    const mdContent = readFileSync(mdPath, 'utf-8');
    expect(mdContent.length).toBeGreaterThan(400000);
    expect(mdContent).toContain('## Findings Detail');
    expect(mdContent).toContain('Finding #0: Detailed security pattern');
    expect(mdContent).toContain('Finding #999: Detailed security pattern');
    expect(mdContent).toContain('Excerpt: `0x');

    // 2. HTML Report with Evidence
    const htmlPath = path.join(tempDir, 'large-report.html');
    await program.parseAsync([
      'node',
      'sre-studio',
      'report',
      testSessionId,
      '--format',
      'html',
      '--include-evidence',
      '--output',
      htmlPath,
    ]);
    expect(existsSync(htmlPath)).toBe(true);
    const htmlContent = readFileSync(htmlPath, 'utf-8');
    expect(htmlContent.length).toBeGreaterThan(400000);
    expect(htmlContent).toContain('<!DOCTYPE html>');
    expect(htmlContent).toContain('Finding #0: Detailed security pattern');
    expect(htmlContent).toContain('Finding #999: Detailed security pattern');

    // 3. JSON Export
    const jsonPath = path.join(tempDir, 'large-report.json');
    await program.parseAsync([
      'node',
      'sre-studio',
      'report',
      testSessionId,
      '--format',
      'json',
      '--output',
      jsonPath,
    ]);
    expect(existsSync(jsonPath)).toBe(true);
    const jsonReport = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    expect(jsonReport.findings.length).toBe(1000); // Default limit is 1000 findings
    expect(jsonReport.statistics.findingsByCategory).toBeDefined();
    expect(jsonReport.session.id).toBe(testSessionId);

    // 4. SARIF 2.1.0 Export
    const sarifPath = path.join(tempDir, 'large-report.sarif');
    await program.parseAsync([
      'node',
      'sre-studio',
      'report',
      testSessionId,
      '--format',
      'sarif',
      '--output',
      sarifPath,
    ]);
    expect(existsSync(sarifPath)).toBe(true);
    const sarifReport = JSON.parse(readFileSync(sarifPath, 'utf-8'));
    expect(sarifReport.version).toBe('2.1.0');
    expect(sarifReport.runs[0].results.length).toBe(1000);
    expect(sarifReport.runs[0].tool.driver.rules.length).toBe(1000);
  });
});
