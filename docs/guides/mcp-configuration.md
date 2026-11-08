# MCP Client Integration Guide

SRE Studio implements the Model Context Protocol (MCP) server over standard input/output (`stdio`) streams. This allows AI assistants like Claude Code, Cursor, and Codex CLI to orchestrate reverse engineering investigations autonomously.

## MCP Server Executable

The MCP server is packaged in `@sre-studio/mcp-server` and provides the binary:

```bash
# Direct execution
node path/to/packages/mcp-server/dist/server.js

# Via package script
pnpm --filter=@sre-studio/mcp-server start
```

---

## 1. Claude Code Integration

Configure SRE Studio in your Claude Code project configuration (`.claude/mcp.json` or `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "sre-studio": {
      "command": "node",
      "args": [
        "C:\\Users\\CWI\\Documents\\GitHub\\software-reverse-engineering-studio\\packages\\mcp-server\\dist\\server.js"
      ],
      "env": {
        "NODE_ENV": "production",
        "SRE_LOG_LEVEL": "warn"
      }
    }
  }
}
```

Or add via Claude Code CLI:
```bash
claude mcp add sre-studio -- node "C:\Users\CWI\Documents\GitHub\software-reverse-engineering-studio\packages\mcp-server\dist\server.js"
```

---

## 2. Cursor Integration

Configure SRE Studio in Cursor settings (`.cursor/mcp.json` or global Cursor settings):

```json
{
  "mcpServers": {
    "sre-studio": {
      "command": "node",
      "args": [
        "C:\\Users\\CWI\\Documents\\GitHub\\software-reverse-engineering-studio\\packages\\mcp-server\\dist\\server.js"
      ],
      "env": {
        "NODE_ENV": "production",
        "SRE_LOG_LEVEL": "warn"
      }
    }
  }
}
```

---

## 3. Codex CLI Native Configuration

Codex CLI uses a native TOML configuration file located at `~/.codex/config.toml`. 

> **Important**: Never overwrite your entire `config.toml`. Append or merge the `[mcp_servers.sre-studio]` table.

### Manual TOML Configuration
Add the following block to `~/.codex/config.toml`:

```toml
[mcp_servers.sre-studio]
command = "node"
args = ["C:\\Users\\CWI\\Documents\\GitHub\\software-reverse-engineering-studio\\packages\\mcp-server\\dist\\server.js"]
working_directory = "C:\\Users\\CWI\\Documents\\GitHub\\software-reverse-engineering-studio"

[mcp_servers.sre-studio.env]
NODE_ENV = "production"
SRE_LOG_LEVEL = "warn"
```

### CLI Command Alternative
Alternatively, use the official Codex CLI registration command:

```bash
codex mcp add sre-studio -- node "C:\Users\CWI\Documents\GitHub\software-reverse-engineering-studio\packages\mcp-server\dist\server.js"
```

---

## Supported MCP Tools

The SRE Studio MCP server provides 8 versioned tools:

| Tool Name | Description |
|-----------|-------------|
| `investigation.start` | Initializes a new investigation session with target, scope, and authorization. |
| `investigation.status` | Queries session status, step progress, and total finding counts. |
| `investigation.close` | Concludes an investigation and generates final summary statistics. |
| `target.register` | Registers an additional primary, secondary, or reference target. |
| `target.list` | Lists all registered targets and metadata in the active session. |
| `analysis.run` | Executes an authorized analysis capability against a target. |
| `analysis.capabilities` | Lists all available analysis capabilities registered in the engine. |
| `evidence.query` | Queries findings from the SQLite database with filtering and pagination. |

All tools validate inputs and outputs using JSON Schema draft 2020-12. Fail-closed authorization boundaries are enforced on every tool call.

