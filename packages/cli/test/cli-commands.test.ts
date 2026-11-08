import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgram } from '../src/index.js';
import { loadGlobalConfig } from '../src/config/global.js';

describe('CLI Commands Suite', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sre-cli-cmds-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createProgram command registration', () => {
    it('registers all 13 required CLI commands', () => {
      const program = createProgram();
      const commandNames = program.commands.map(cmd => cmd.name());

      const expected = [
        'init',
        'analyze',
        'status',
        'target',
        'evidence',
        'capabilities',
        'close',
        'doctor',
        'config',
        'investigate',
        'report',
        'provider',
        'agent-config',
      ];

      for (const name of expected) {
        expect(commandNames).toContain(name);
      }
    });
  });

  describe('capabilities command', () => {
    it('executes capabilities command without error', async () => {
      const program = createProgram();
      program.exitOverride();

      await expect(
        program.parseAsync(['node', 'sre-studio', 'capabilities', '--format', 'json'])
      ).resolves.not.toThrow();
    });
  });

  describe('provider command', () => {
    it('lists registered providers in table/json format', async () => {
      const program = createProgram();
      program.exitOverride();

      await expect(
        program.parseAsync(['node', 'sre-studio', 'provider', 'list', '--format', 'json'])
      ).resolves.not.toThrow();
    });

    it('checks provider status for rizin and android', async () => {
      const program = createProgram();
      program.exitOverride();

      await expect(
        program.parseAsync(['node', 'sre-studio', 'provider', 'status', 'rizin', '--format', 'json'])
      ).resolves.not.toThrow();
    });

    it('configures custom provider path', async () => {
      const program = createProgram();
      program.exitOverride();

      await program.parseAsync([
        'node',
        'sre-studio',
        'provider',
        'configure',
        'rizin',
        '--path',
        'C:/tools/rizin.exe',
      ]);

      const globalConfig = await loadGlobalConfig();
      expect(globalConfig.providers?.['rizin']?.path).toBe('C:/tools/rizin.exe');
      expect(globalConfig.providers?.['rizin']?.enabled).toBe(true);
    });
  });

  describe('doctor command', () => {
    it('runs diagnostics and outputs JSON format', async () => {
      const program = createProgram();
      program.exitOverride();

      await expect(
        program.parseAsync(['node', 'sre-studio', 'doctor', '--json'])
      ).resolves.not.toThrow();
    });

    it('diagnoses a specific provider', async () => {
      const program = createProgram();
      program.exitOverride();

      await expect(
        program.parseAsync(['node', 'sre-studio', 'doctor', '--provider', 'rizin'])
      ).resolves.not.toThrow();
    });
  });

  describe('investigation lifecycle commands', () => {
    it('initializes project, registers target, and inspects status', async () => {
      const projectDir = path.join(tempDir, 'my-investigation');
      const dummyTarget = path.join(tempDir, 'sample.exe');
      writeFileSync(dummyTarget, 'MZ-DUMMY-EXECUTABLE-DATA');

      const program = createProgram();
      program.exitOverride();

      // 1. init
      await program.parseAsync([
        'node',
        'sre-studio',
        'init',
        projectDir,
        '--type',
        'binary',
        '--target',
        dummyTarget,
      ]);

      expect(existsSync(path.join(projectDir, '.sre-studio', 'project.yaml'))).toBe(true);
      expect(existsSync(path.join(projectDir, '.sre-studio', 'investigation.db'))).toBe(true);

      // Chdir into project for subsequent project-relative commands
      process.chdir(projectDir);

      // 2. target list
      const targetProg = createProgram();
      targetProg.exitOverride();
      await expect(
        targetProg.parseAsync(['node', 'sre-studio', 'target', 'list', '--format', 'json'])
      ).resolves.not.toThrow();

      // 3. target add
      const secondTarget = path.join(tempDir, 'library.dll');
      writeFileSync(secondTarget, 'MZ-DUMMY-DLL');
      const addProg = createProgram();
      addProg.exitOverride();
      await expect(
        addProg.parseAsync([
          'node',
          'sre-studio',
          'target',
          'add',
          secondTarget,
          '--type',
          'binary',
          '--role',
          'secondary',
        ])
      ).resolves.not.toThrow();

      // 4. close session
      const { createRepository } = await import('@sre-studio/core');
      const { loadProjectConfig } = await import('../src/config/project.js');
      const pConfig = await loadProjectConfig(projectDir);
      expect(pConfig).not.toBeNull();

      const repo = createRepository({ dbPath: pConfig!.databasePath });
      const sessions = repo.listSessions();
      repo.close();

      expect(sessions.length).toBeGreaterThan(0);
      const activeSessionId = sessions[0]!.id;

      const closeProg = createProgram();
      closeProg.exitOverride();
      await expect(
        closeProg.parseAsync([
          'node',
          'sre-studio',
          'close',
          '--session',
          activeSessionId,
          '--reason',
          'completed',
        ])
      ).resolves.not.toThrow();
    });
  });
});

