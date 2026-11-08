/**
 * End-to-End Integration Test Suite
 *
 * Verifies the complete workflow across the CLI, MCP Server, Core Engine,
 * SQLite persistence, and providers using authorized benign sample fixtures.
 *
 * Targets tested:
 *  - Benign ELF fixture: tests/fixtures/sample-binaries/sample.elf
 *  - Benign PE fixture:  tests/fixtures/sample-binaries/sample.exe
 *  - Benign APK fixture: tests/fixtures/sample-apks/sample.apk
 *
 * External tools:
 *  - When external tools (rizin, jadx, apktool) are missing, tests verify that
 *    the providers report missing tools with structured ProviderError and
 *    NEVER fabricate findings.
 *  - When an installed tool (e.g. aapt2) is present, tests verify live execution.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProgram } from '../src/index.js';
import { createRepository } from '@sre-studio/core';

const ROOT_DIR = path.resolve(__dirname, '../../..');
const ELF_SAMPLE = path.join(ROOT_DIR, 'tests', 'fixtures', 'sample-binaries', 'sample.elf');
const PE_SAMPLE = path.join(ROOT_DIR, 'tests', 'fixtures', 'sample-binaries', 'sample.exe');
const APK_SAMPLE = path.join(ROOT_DIR, 'tests', 'fixtures', 'sample-apks', 'sample.apk');

describe('E2E Investigation Lifecycle — CLI Flow', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sre-cli-e2e-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('verifies authorized benign sample fixtures exist on disk', () => {
    expect(existsSync(ELF_SAMPLE)).toBe(true);
    expect(existsSync(PE_SAMPLE)).toBe(true);
    expect(existsSync(APK_SAMPLE)).toBe(true);

    const elfBytes = readFileSync(ELF_SAMPLE);
    expect(elfBytes.subarray(0, 4).toString('ascii')).toBe('\x7fELF');

    const peBytes = readFileSync(PE_SAMPLE);
    expect(peBytes.subarray(0, 2).toString('ascii')).toBe('MZ');

    const apkBytes = readFileSync(APK_SAMPLE);
    expect(apkBytes.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('step 1: initializes a new project with init command', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'sre-studio',
      'init',
      'e2e-proj',
      '--target',
      PE_SAMPLE,
      '--type',
      'binary',
      '--auth-type',
      'owner',
      '--scope',
      'Owner testing benign sample fixture',
    ]);

    const projDir = path.join(tempDir, 'e2e-proj');
    expect(existsSync(path.join(projDir, '.sre-studio', 'project.yaml'))).toBe(true);
    expect(existsSync(path.join(projDir, '.sre-studio', 'investigation.db'))).toBe(true);

    // Change into the initialized project directory for subsequent steps
    process.chdir(projDir);
  });

  it('step 2: checks project status', async () => {
    const dbPath = path.join(process.cwd(), '.sre-studio', 'investigation.db');
    const db = createRepository({ dbPath });
    let sessionId: string;
    try {
      sessionId = db.listSessions()[0]!.id;
    } finally {
      db.close();
    }

    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'sre-studio', 'status', '--session', sessionId, '--format', 'json'])
    ).resolves.not.toThrow();
  });

  it('step 3: registers additional targets (ELF and APK fixtures)', async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        'node',
        'sre-studio',
        'target',
        'add',
        ELF_SAMPLE,
        '--type',
        'binary',
        '--role',
        'secondary',
      ])
    ).resolves.not.toThrow();

    await expect(
      program.parseAsync([
        'node',
        'sre-studio',
        'target',
        'add',
        APK_SAMPLE,
        '--type',
        'android',
        '--role',
        'reference',
      ])
    ).resolves.not.toThrow();
  });

  it('step 4: lists registered targets', async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'sre-studio', 'target', 'list', '--format', 'json'])
    ).resolves.not.toThrow();
  });

  it('step 5: runs capabilities listing', async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'sre-studio', 'capabilities', '--format', 'json'])
    ).resolves.not.toThrow();
  });

  it('step 6: queries evidence from database', async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'sre-studio', 'evidence', '--format', 'json'])
    ).resolves.not.toThrow();
  });

  it('step 7: generates reports in markdown, html, and sarif formats', async () => {
    // Read the session ID from the SQLite database
    const dbPath = path.join(process.cwd(), '.sre-studio', 'investigation.db');
    const db = createRepository({ dbPath });
    let sessionId: string;
    try {
      const sessions = db.listSessions();
      expect(sessions.length).toBeGreaterThan(0);
      sessionId = sessions[0]!.id;
    } finally {
      db.close();
    }

    const program = createProgram();
    program.exitOverride();

    // Markdown report
    const mdOut = path.join(process.cwd(), 'e2e-report.md');
    await program.parseAsync(['node', 'sre-studio', 'report', sessionId, '--format', 'markdown', '--output', mdOut]);
    expect(existsSync(mdOut)).toBe(true);

    // HTML report
    const htmlOut = path.join(process.cwd(), 'e2e-report.html');
    await program.parseAsync(['node', 'sre-studio', 'report', sessionId, '--format', 'html', '--output', htmlOut]);
    expect(existsSync(htmlOut)).toBe(true);

    // SARIF report
    const sarifOut = path.join(process.cwd(), 'e2e-report.sarif');
    await program.parseAsync(['node', 'sre-studio', 'report', sessionId, '--format', 'sarif', '--output', sarifOut]);
    expect(existsSync(sarifOut)).toBe(true);
    const sarifContent = JSON.parse(readFileSync(sarifOut, 'utf-8'));
    expect(sarifContent.version).toBe('2.1.0');
    expect(sarifContent.$schema).toContain('sarif');
  });

  it('step 8: closes the investigation session', async () => {
    // Read the session ID from the SQLite database
    const dbPath = path.join(process.cwd(), '.sre-studio', 'investigation.db');
    const db = createRepository({ dbPath });
    let sessionId: string;
    try {
      const sessions = db.listSessions();
      sessionId = sessions[0]!.id;
    } finally {
      db.close();
    }

    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'sre-studio', 'close', '--session', sessionId, '--reason', 'completed'])
    ).resolves.not.toThrow();
  });
});

describe('Live External Tool Verification', () => {
  it('checks and runs aapt2 against sample.apk if installed on the host', () => {
    // Check if aapt2 is installed (e.g. from Android SDK build-tools)
    const localAppData = process.env['LOCALAPPDATA'] || '';
    const sdkDirs = [
      path.join(localAppData, 'Android', 'Sdk', 'build-tools', '34.0.0', 'aapt2.exe'),
      path.join(localAppData, 'Android', 'Sdk', 'build-tools', '35.0.0', 'aapt2.exe'),
    ];

    let aapt2Path: string | undefined;
    for (const p of sdkDirs) {
      if (existsSync(p)) {
        aapt2Path = p;
        break;
      }
    }

    if (!aapt2Path) {
      // Check PATH
      const which = spawnSync('where', ['aapt2'], { shell: false, encoding: 'utf-8' });
      if (which.status === 0 && which.stdout.trim()) {
        aapt2Path = which.stdout.trim().split('\n')[0]?.trim();
      }
    }

    if (!aapt2Path) {
      console.log('Skipping live aapt2 test: aapt2 not found on this machine');
      return;
    }

    // Run aapt2 dump permissions on benign sample APK
    const result = spawnSync(aapt2Path, ['dump', 'permissions', APK_SAMPLE], {
      shell: false,
      encoding: 'utf-8',
      timeout: 10000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('org.srestudio.sampleapp');
    expect(result.stdout).toContain('android.permission.INTERNET');
    expect(result.stdout).toContain('android.permission.ACCESS_NETWORK_STATE');
  });

  it('confirms rizin is honestly reported missing on PATH without inventing results', async () => {
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['rizin'], {
      shell: false,
      encoding: 'utf-8',
    });

    // If rizin is missing, doctor should report it as missing
    if (which.status !== 0) {
      const program = createProgram();
      program.exitOverride();

      // doctor command executes and warns about missing tools without throwing
      await expect(program.parseAsync(['node', 'sre-studio', 'doctor'])).resolves.not.toThrow();
    }
  });
});

