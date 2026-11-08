# Agent MCP Configurations

This directory contains configuration examples for connecting AI coding agents to the SRE Studio MCP Server (`sre-studio-mcp`).

## Available Configurations

| Agent | Config File | Format | Default Location |
|-------|-------------|--------|------------------|
| **Claude Code** | `claude-code.mcp.json` | JSON (`mcpServers`) | `.mcp.json` or `~/.claude.json` |
| **Cursor** | `cursor.mcp.json` | JSON (`mcpServers`) | `.cursor/mcp.json` or `~/.cursor/mcp.json` |
| **Codex CLI** | `codex-cli.toml` | TOML (`[mcp_servers]`) | `~/.codex/config.toml` or `.codex/config.toml` |

---

## 1. OpenAI Codex CLI Configuration

According to official OpenAI documentation, Codex CLI uses **TOML** syntax (`~/.codex/config.toml` or project-scoped `.codex/config.toml`), declaring MCP servers under the `[mcp_servers.<name>]` table.

> [!WARNING]
> **Preserve Existing Configuration**: Never overwrite your entire `config.toml` file. Doing so would erase your existing model configurations, aliases, and other registered MCP servers. Always append the new table or use the CLI command below.

### Option A: Automatic Registration via CLI (Recommended)

Run the native `codex mcp add` command from your terminal:

```bash
codex mcp add sre-studio \
  --env SRE_STUDIO_WORKSPACE=. \
  --env SRE_STUDIO_CONFIG=./.sre-studio/config.yaml \
  -- sre-studio-mcp
```

### Option B: Manual TOML Configuration (Safe Append)

Append the following block to your `~/.codex/config.toml` (global) or `.codex/config.toml` (project scope):

```toml
[mcp_servers.sre-studio]
command = "sre-studio-mcp"
args = []
cwd = "."

[mcp_servers.sre-studio.env]
SRE_STUDIO_WORKSPACE = "."
SRE_STUDIO_CONFIG = "./.sre-studio/config.yaml"
```

### Verifying Codex CLI Setup
- List registered servers: `codex mcp list`
- Verify inside an active Codex session: type `/mcp`

---

## 2. Claude Code Configuration

Claude Code uses standard JSON with a top-level `mcpServers` object.

Add to your project's `.mcp.json` or user-level `~/.claude.json`:

```json
{
  "mcpServers": {
    "sre-studio": {
      "command": "sre-studio-mcp",
      "args": [],
      "env": {
        "SRE_STUDIO_WORKSPACE": "${workspaceFolder}",
        "SRE_STUDIO_CONFIG": "${workspaceFolder}/.sre-studio/config.yaml"
      }
    }
  }
}
```

---

## 3. Cursor Configuration

Cursor uses project-level `.cursor/mcp.json` or global `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sre-studio": {
      "command": "sre-studio-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

---

## Testing Disclaimer

The configuration files in this directory are validated for syntax correctness, required field schema compliance, and cross-agent consistency via automated tests. However, **live compatibility testing with actual agent client runtimes has not been performed** because Claude Code, Cursor, and Codex CLI client binaries are not installed in the current environment.

