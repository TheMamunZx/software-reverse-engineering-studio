# SRE Studio Architecture Overview

Software Reverse Engineering (SRE) Studio is an agent-native reverse engineering platform built with a clean-room, multi-tier architecture. It separates presentation, orchestration, domain logic, external tool providers, and persistence into distinct, decoupled packages.

## Monorepo Package Topology

```
┌───────────────────────────────────────────────────────────┐
│                       Client Tier                         │
│   AI Agents (Claude Code, Cursor, Codex CLI)   CLI User   │
└─────────────────────────────┬───────────────────────┬─────┘
                              │ stdio JSON-RPC        │
                              ▼                       │
               ┌─────────────────────────────┐        │
               │   @sre-studio/mcp-server    │        │
               │  (Transport & Protocol)     │        │
               └──────────────┬──────────────┘        │
                              │                       ▼
                              │            ┌─────────────────────┐
                              │            │   @sre-studio/cli   │
                              │            │ (Human Terminal UX) │
                              │            └──────────┬──────────┘
                              ▼                       ▼
            ┌───────────────────────────────────────────────┐
            │              @sre-studio/core                 │
            │  Investigation Orchestrator                   │
            │  Session Manager                              │
            │  Evidence Engine                              │
            │  Authorization Manager (Fail-Closed)          │
            │  Provider Registry                            │
            │  SQLite Adapter & Repositories                │
            └──────────────┬───────────────────┬────────────┘
                           │                   │
                           ▼                   ▼
       ┌────────────────────────┐  ┌────────────────────────┐
       │ @sre-studio/           │  │ @sre-studio/           │
       │ provider-binary        │  │ provider-android       │
       │ (Rizin, rabin2)        │  │ (aapt2, JADX, apktool) │
       └────────────────────────┘  └────────────────────────┘
                           │                   │
                           ▼                   ▼
       ┌────────────────────────────────────────────────────┐
       │              @sre-studio/shared                    │
       │  Types, Errors, Logger, JSON Schemas, Validations  │
       └────────────────────────────────────────────────────┘
```

## Architectural Principles

### 1. Agent-Native Design
The platform provides a Model Context Protocol (MCP) server that exposes 8 core tools with versioned JSON Schema draft 2020-12 input and output validation. AI agents interact deterministically via standard JSON-RPC over stdio streams.

### 2. Clean Separation of Concerns
- **`@sre-studio/shared`**: Cross-cutting foundation containing domain types, custom error classes, Pino logging factory, and compiled JSON Schema validators. Zero dependencies on higher layers.
- **`@sre-studio/core`**: The brain of the platform. Owns the session lifecycle, evidence graph, fail-closed authorization boundaries, and SQLite persistence. Does not depend on CLI or MCP server.
- **`@sre-studio/mcp-server`**: Thin protocol adapter exposing Core capabilities via MCP stdio transport. Contains zero reverse-engineering logic.
- **`@sre-studio/cli`**: Terminal user interface built with Commander, Chalk, and Ora. Provides human workflows: project initialization, target registration, analysis execution, evidence querying, and multi-format report generation.
- **`@sre-studio/provider-binary`**: Static binary analysis provider interfacing safely with Rizin and `rabin2`.
- **`@sre-studio/provider-android`**: Static Android APK provider interfacing safely with `aapt2`, `apksigner`, `jadx`, and `apktool`.

### 3. Fail-Closed Security & Authorization
No operation, target registration, or analysis capability executes unless explicitly authorized by configured boundary rules.
- Empty boundaries reject all operations.
- Path normalization prevents directory traversal (`..`) bypasses.
- Target SHA-256 hashes are verified against allowlists.
- Analyzed binaries and APKs are **never executed**. All reverse engineering is purely static inspection via child processes.

### 4. Normalized SQLite Persistence
The system persists sessions, targets, environments, findings, and evidence references using `better-sqlite3` with foreign key enforcement (`PRAGMA foreign_keys = ON;`) and WAL mode enabled:
- **`sessions`**: Investigation metadata, status, created by, and progress tracking.
- **`targets`**: Registered binaries and APKs with roles (`primary`, `secondary`, `reference`), paths, and hashes.
- **`environments`**: Normalized execution snapshots (OS, arch, tool versions, target hash) captured once and referenced by findings.
- **`findings`**: Structured evidence records with categorical classifications, severity, numerical confidence, factor breakdowns, justifications, and limitations.
- **`evidence`**: Raw artifact snippets, disassemblies, decompilations, and byte-range references.
- **`audit_log`**: Comprehensive immutable record of all authorization requests and decisions.

