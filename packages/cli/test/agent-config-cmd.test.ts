import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgram } from '../src/index.js';

describe('agent-config CLI command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sre-cli-agent-config-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates Claude Code configuration file in target directory', async () => {
    const program = createProgram();
    program.exitOverride();

    const outputFile = path.join(tempDir, '.claude', 'mcp.json');
    await program.parseAsync([
      'node',
      'sre-studio',
      'agent-config',
      'claude-code',
      '--output',
      outputFile,
    ]);

    expect(existsSync(outputFile)).toBe(true);
    const content = JSON.parse(readFileSync(outputFile, 'utf-8'));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers['sre-studio']).toBeDefined();
    expect(content.mcpServers['sre-studio'].command).toBe('sre-studio-mcp');
  });

  it('generates Cursor configuration file with mcpServers key', async () => {
    const program = createProgram();
    program.exitOverride();

    const outputFile = path.join(tempDir, '.cursor', 'mcp.json');
    await program.parseAsync([
      'node',
      'sre-studio',
      'agent-config',
      'cursor',
      '--output',
      outputFile,
    ]);

    expect(existsSync(outputFile)).toBe(true);
    const content = JSON.parse(readFileSync(outputFile, 'utf-8'));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers['sre-studio'].command).toBe('sre-studio-mcp');
    expect(content.mcpServers['sre-studio'].args).toEqual([]);
  });

  it('generates native Codex CLI TOML configuration with [mcp_servers.sre-studio]', async () => {
    const program = createProgram();
    program.exitOverride();

    const outputFile = path.join(tempDir, 'codex-config.toml');
    await program.parseAsync([
      'node',
      'sre-studio',
      'agent-config',
      'codex-cli',
      '--output',
      outputFile,
    ]);

    expect(existsSync(outputFile)).toBe(true);
    const content = readFileSync(outputFile, 'utf-8');
    expect(content).toContain('[mcp_servers.sre-studio]');
    expect(content).toContain('command = "sre-studio-mcp"');
    expect(content).toContain('codex mcp add sre-studio');
  });

  it('supports --auto detection without crashing', async () => {
    const program = createProgram();
    program.exitOverride();

    // In a blank temp directory, auto detection runs and reports detected agents or defaults
    await expect(
      program.parseAsync(['node', 'sre-studio', 'agent-config', '--auto'])
    ).resolves.not.toThrow();
  });
});
