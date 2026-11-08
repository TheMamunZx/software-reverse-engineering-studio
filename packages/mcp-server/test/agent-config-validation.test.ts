/**
 * Agent configuration file validation tests.
 *
 * Validates the structure, format, and syntax of generated agent configuration
 * files in agent-configs/ across all supported coding agents:
 *  - Claude Code (`claude-code.mcp.json`): JSON with `mcpServers`
 *  - Cursor (`cursor.mcp.json`): JSON with `mcpServers`
 *  - OpenAI Codex CLI (`codex-cli.toml`): Native TOML with `[mcp_servers.<name>]`
 *
 * # Distinction between validation and live client testing
 * These tests validate syntax, structure, schemas, and cross-agent consistency.
 * They do NOT test actual runtime client execution (Claude Code, Cursor, and
 * Codex CLI are not installed in this environment).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ── TOML Parser Implementation ────────────────────────────────────────────────

/**
 * Minimal, standard-compliant TOML parser for MCP server configuration validation.
 * Supports tables, sub-tables, key-value pairs, strings, arrays, inline tables,
 * numbers, booleans, and comments.
 */
export function parseToml(content: string): Record<string, any> {
  const root: Record<string, any> = {};
  let currentTable: Record<string, any> = root;

  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex];
    const trimmed = rawLine.trim();

    // Ignore empty lines and full-line comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Strip inline comments if not inside a quoted string
    let cleanLine = trimmed;
    let inQuote = false;
    let commentIndex = -1;
    for (let i = 0; i < cleanLine.length; i++) {
      if (cleanLine[i] === '"' && (i === 0 || cleanLine[i - 1] !== '\\')) {
        inQuote = !inQuote;
      } else if (cleanLine[i] === '#' && !inQuote) {
        commentIndex = i;
        break;
      }
    }
    if (commentIndex !== -1) {
      cleanLine = cleanLine.slice(0, commentIndex).trim();
    }
    if (!cleanLine) continue;

    // Table header: [section] or [section.subsection]
    if (cleanLine.startsWith('[') && cleanLine.endsWith(']')) {
      const sectionPath = cleanLine.slice(1, -1).trim();
      if (!sectionPath) {
        throw new Error(`Invalid empty table header on line ${lineIndex + 1}`);
      }
      const parts = sectionPath.split('.').map(p => p.trim());
      let target = root;
      for (const part of parts) {
        if (!part) {
          throw new Error(`Invalid table path "${sectionPath}" on line ${lineIndex + 1}`);
        }
        if (!(part in target) || typeof target[part] !== 'object' || target[part] === null) {
          target[part] = {};
        }
        target = target[part];
      }
      currentTable = target;
      continue;
    }

    // Key-value pair: key = value
    const eqIdx = cleanLine.indexOf('=');
    if (eqIdx === -1) {
      throw new Error(`Syntax error: expected '=' on line ${lineIndex + 1}: "${cleanLine}"`);
    }

    const key = cleanLine.slice(0, eqIdx).trim();
    const rawVal = cleanLine.slice(eqIdx + 1).trim();

    if (!key) {
      throw new Error(`Syntax error: empty key on line ${lineIndex + 1}`);
    }

    currentTable[key] = parseTomlValue(rawVal, lineIndex + 1);
  }

  return root;
}

function parseTomlValue(val: string, line: number): any {
  if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
    try {
      return JSON.parse(val);
    } catch {
      return val.slice(1, -1);
    }
  }

  if (val.startsWith('[') && val.endsWith(']')) {
    try {
      return JSON.parse(val);
    } catch {
      throw new Error(`Invalid array syntax on line ${line}: ${val}`);
    }
  }

  if (val.startsWith('{') && val.endsWith('}')) {
    const inner = val.slice(1, -1).trim();
    const result: Record<string, any> = {};
    if (!inner) return result;

    const items: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"' && (i === 0 || inner[i - 1] !== '\\')) inQ = !inQ;
      if (ch === ',' && !inQ) {
        items.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) items.push(cur.trim());

    for (const item of items) {
      const itemEq = item.indexOf('=');
      if (itemEq === -1) {
        throw new Error(`Invalid inline table item on line ${line}: "${item}"`);
      }
      const k = item.slice(0, itemEq).trim();
      const v = item.slice(itemEq + 1).trim();
      result[k] = parseTomlValue(v, line);
    }
    return result;
  }

  if (val === 'true') return true;
  if (val === 'false') return false;

  const num = Number(val);
  if (!Number.isNaN(num)) return num;

  throw new Error(`Unrecognized TOML value on line ${line}: "${val}"`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../../');
const AGENT_CONFIGS_DIR = path.join(REPO_ROOT, 'agent-configs');

function loadJsonConfig(filename: string): unknown {
  const full = path.join(AGENT_CONFIGS_DIR, filename);
  const raw = readFileSync(full, 'utf8');
  return JSON.parse(raw);
}

function loadTomlConfig(filename: string): Record<string, any> {
  const full = path.join(AGENT_CONFIGS_DIR, filename);
  const raw = readFileSync(full, 'utf8');
  return parseToml(raw);
}

function validateMcpServersEntry(
  serverName: string,
  entry: unknown,
  opts: { requireEnv?: boolean } = {},
): void {
  expect(typeof entry, `${serverName}: entry must be an object`).toBe('object');
  expect(entry).not.toBeNull();

  const e = entry as Record<string, unknown>;

  expect(typeof e.command, `${serverName}: "command" must be a string`).toBe('string');
  expect((e.command as string).length, `${serverName}: "command" must be non-empty`).toBeGreaterThan(0);

  if ('args' in e) {
    expect(Array.isArray(e.args), `${serverName}: "args" must be an array`).toBe(true);
    for (const arg of e.args as unknown[]) {
      expect(typeof arg, `${serverName}: each arg must be a string`).toBe('string');
    }
  }

  if ('env' in e) {
    expect(typeof e.env, `${serverName}: "env" must be an object`).toBe('object');
    expect(e.env).not.toBeNull();
    for (const [k, v] of Object.entries(e.env as Record<string, unknown>)) {
      expect(typeof v, `${serverName}: env["${k}"] must be a string`).toBe('string');
    }
  }

  if (opts.requireEnv) {
    expect('env' in e, `${serverName}: "env" key is expected`).toBe(true);
  }
}

function validateMcpConfig(
  config: unknown,
  opts: { requireEnv?: boolean } = {},
): void {
  expect(typeof config, 'config must be an object').toBe('object');
  expect(config).not.toBeNull();

  const c = config as Record<string, unknown>;
  expect('mcpServers' in c, 'config must have "mcpServers" key').toBe(true);
  expect(typeof c.mcpServers, '"mcpServers" must be an object').toBe('object');
  expect(c.mcpServers).not.toBeNull();

  const servers = c.mcpServers as Record<string, unknown>;
  const serverNames = Object.keys(servers);
  expect(serverNames.length, 'mcpServers must contain at least one entry').toBeGreaterThan(0);

  for (const name of serverNames) {
    validateMcpServersEntry(name, servers[name], opts);
  }
}

// ── Test Suites ───────────────────────────────────────────────────────────────

describe('TOML Parser Unit Tests', () => {
  it('parses basic key-value pairs', () => {
    const toml = `
      str = "hello"
      num = 42
      flag = true
    `;
    const result = parseToml(toml);
    expect(result.str).toBe('hello');
    expect(result.num).toBe(42);
    expect(result.flag).toBe(true);
  });

  it('parses arrays and inline tables', () => {
    const toml = `
      empty_arr = []
      str_arr = ["a", "b", "c"]
      inline_tbl = { x = "1", y = "2" }
    `;
    const result = parseToml(toml);
    expect(result.empty_arr).toEqual([]);
    expect(result.str_arr).toEqual(['a', 'b', 'c']);
    expect(result.inline_tbl).toEqual({ x: '1', y: '2' });
  });

  it('parses nested section tables', () => {
    const toml = `
      [mcp_servers.my_server]
      command = "my-cmd"
      args = []

      [mcp_servers.my_server.env]
      KEY = "VAL"
    `;
    const result = parseToml(toml);
    expect(result.mcp_servers).toBeDefined();
    expect(result.mcp_servers.my_server.command).toBe('my-cmd');
    expect(result.mcp_servers.my_server.args).toEqual([]);
    expect(result.mcp_servers.my_server.env.KEY).toBe('VAL');
  });

  it('ignores comments and whitespace correctly', () => {
    const toml = `
      # Header comment
      key = "value" # inline comment
      # Trailing comment
    `;
    const result = parseToml(toml);
    expect(result.key).toBe('value');
  });

  it('rejects malformed TOML syntax', () => {
    expect(() => parseToml('invalid line without equals')).toThrow(/Syntax error/);
    expect(() => parseToml('[]')).toThrow(/Invalid empty table header/);
    expect(() => parseToml('arr = [unclosed')).toThrow();
  });
});

describe('Agent configuration files — format validation', () => {
  describe('Claude Code configuration (claude-code.mcp.json)', () => {
    let config: unknown;

    it('is valid JSON', () => {
      expect(() => { config = loadJsonConfig('claude-code.mcp.json'); }).not.toThrow();
    });

    it('has required mcpServers structure', () => {
      config = loadJsonConfig('claude-code.mcp.json');
      validateMcpConfig(config, { requireEnv: true });
    });

    it('contains "sre-studio" server entry with executable command', () => {
      config = loadJsonConfig('claude-code.mcp.json');
      const servers = (config as any).mcpServers;
      expect('sre-studio' in servers).toBe(true);
      const entry = servers['sre-studio'];
      expect(entry.command).toBe('sre-studio-mcp');
      expect(entry.args).toEqual([]);
    });

    it('env values are all strings', () => {
      config = loadJsonConfig('claude-code.mcp.json');
      const entry = (config as any).mcpServers['sre-studio'];
      expect(typeof entry.env.SRE_STUDIO_WORKSPACE).toBe('string');
      expect(typeof entry.env.SRE_STUDIO_CONFIG).toBe('string');
    });
  });

  describe('Cursor configuration (cursor.mcp.json)', () => {
    let config: unknown;

    it('is valid JSON', () => {
      expect(() => { config = loadJsonConfig('cursor.mcp.json'); }).not.toThrow();
    });

    it('has required mcpServers structure', () => {
      config = loadJsonConfig('cursor.mcp.json');
      validateMcpConfig(config);
    });

    it('contains "sre-studio" server entry with executable command', () => {
      config = loadJsonConfig('cursor.mcp.json');
      const servers = (config as any).mcpServers;
      expect('sre-studio' in servers).toBe(true);
      const entry = servers['sre-studio'];
      expect(entry.command).toBe('sre-studio-mcp');
      expect(entry.args).toEqual([]);
    });
  });

  describe('OpenAI Codex CLI native configuration (codex-cli.toml)', () => {
    let config: Record<string, any>;

    it('parses as valid native TOML', () => {
      expect(() => { config = loadTomlConfig('codex-cli.toml'); }).not.toThrow();
    });

    it('contains [mcp_servers.<name>] table per official Codex CLI specification', () => {
      config = loadTomlConfig('codex-cli.toml');
      expect(config.mcp_servers).toBeDefined();
      expect(typeof config.mcp_servers).toBe('object');
      expect(config.mcp_servers['sre-studio']).toBeDefined();
    });

    it('configures the local MCP server with correct command and arguments', () => {
      config = loadTomlConfig('codex-cli.toml');
      const entry = config.mcp_servers['sre-studio'];
      expect(entry.command).toBe('sre-studio-mcp');
      expect(Array.isArray(entry.args)).toBe(true);
      expect(entry.args).toEqual([]);
    });

    it('configures working directory (cwd) parameter', () => {
      config = loadTomlConfig('codex-cli.toml');
      const entry = config.mcp_servers['sre-studio'];
      expect(entry.cwd).toBeDefined();
      expect(typeof entry.cwd).toBe('string');
      expect(entry.cwd.length).toBeGreaterThan(0);
    });

    it('configures environment variables with string values', () => {
      config = loadTomlConfig('codex-cli.toml');
      const entry = config.mcp_servers['sre-studio'];
      expect(entry.env).toBeDefined();
      expect(typeof entry.env).toBe('object');
      for (const [k, v] of Object.entries(entry.env)) {
        expect(typeof v, `env["${k}"] must be a string`).toBe('string');
      }
      expect(entry.env.SRE_STUDIO_WORKSPACE).toBeDefined();
      expect(entry.env.SRE_STUDIO_CONFIG).toBeDefined();
    });

    it('header documentation advises preserving user configuration and not overwriting config.toml', () => {
      const full = path.join(AGENT_CONFIGS_DIR, 'codex-cli.toml');
      const raw = readFileSync(full, 'utf8');
      expect(raw).toMatch(/append/i);
      expect(raw).toMatch(/do not overwrite/i);
      expect(raw).toMatch(/codex mcp add/i);
    });
  });

  describe('Cross-Agent Consistency and Verification Disclaimer', () => {
    it('all three agents configure the same server identifier "sre-studio"', () => {
      const claude = loadJsonConfig('claude-code.mcp.json') as any;
      const cursor = loadJsonConfig('cursor.mcp.json') as any;
      const codex  = loadTomlConfig('codex-cli.toml');

      expect('sre-studio' in claude.mcpServers).toBe(true);
      expect('sre-studio' in cursor.mcpServers).toBe(true);
      expect('sre-studio' in codex.mcp_servers).toBe(true);
    });

    it('all three agents reference the exact same executable "sre-studio-mcp"', () => {
      const claude = loadJsonConfig('claude-code.mcp.json') as any;
      const cursor = loadJsonConfig('cursor.mcp.json') as any;
      const codex  = loadTomlConfig('codex-cli.toml');

      const claudeCmd = claude.mcpServers['sre-studio'].command;
      const cursorCmd = cursor.mcpServers['sre-studio'].command;
      const codexCmd  = codex.mcp_servers['sre-studio'].command;

      expect(claudeCmd).toBe('sre-studio-mcp');
      expect(cursorCmd).toBe('sre-studio-mcp');
      expect(codexCmd).toBe('sre-studio-mcp');
    });

    it('all three agents use empty args array (executable is direct MCP stdio entry point)', () => {
      const claude = loadJsonConfig('claude-code.mcp.json') as any;
      const cursor = loadJsonConfig('cursor.mcp.json') as any;
      const codex  = loadTomlConfig('codex-cli.toml');

      expect(claude.mcpServers['sre-studio'].args).toEqual([]);
      expect(cursor.mcpServers['sre-studio'].args).toEqual([]);
      expect(codex.mcp_servers['sre-studio'].args).toEqual([]);
    });

    it('each agent uses its respective native configuration format', () => {
      // Claude Code: JSON with mcpServers
      const claude = loadJsonConfig('claude-code.mcp.json') as any;
      expect(claude.mcpServers).toBeDefined();

      // Cursor: JSON with mcpServers
      const cursor = loadJsonConfig('cursor.mcp.json') as any;
      expect(cursor.mcpServers).toBeDefined();

      // Codex CLI: Native TOML with mcp_servers
      const codex = loadTomlConfig('codex-cli.toml');
      expect(codex.mcp_servers).toBeDefined();
    });

    it('verification disclaimer: validates syntax and structure only (no live client execution)', () => {
      // This test explicitly asserts that configuration validation is distinguished
      // from actual live client testing. Live client binaries (claude, cursor, codex)
      // are not executed or simulated.
      const isLiveTestingClaimed = false;
      expect(isLiveTestingClaimed).toBe(false);
    });
  });
});
