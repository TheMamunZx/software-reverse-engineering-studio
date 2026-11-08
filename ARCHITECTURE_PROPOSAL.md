# Software Reverse Engineering Studio — Architecture Proposal (Revised MVP)

**Phase 1 Deliverable:** Analysis and Architecture Planning Only
**Status:** Revised — Awaiting Final Implementation Approval
**Date:** 2026-11-07

---

## Table of Contents

1. [Revised MVP Scope](#1-revised-mvp-scope)
2. [Current Repository Assessment](#2-current-repository-assessment)
3. [Proposed System Architecture](#3-proposed-system-architecture)
4. [Proposed Directory Tree](#4-proposed-directory-tree)
5. [Package and Module Responsibilities](#5-package-and-module-responsibilities)
6. [MCP Server Design](#6-mcp-server-design)
7. [CLI Command Design](#7-cli-command-design)
8. [Evidence Data Model](#8-evidence-data-model)
9. [Provider Abstraction Design](#9-provider-abstraction-design)
10. [Agent Integration Strategy](#10-agent-integration-strategy)
11. [Security and Authorization Model](#11-security-and-authorization-model)
12. [Testing Strategy](#12-testing-strategy)
13. [Development Roadmap](#13-development-roadmap)
14. [Risks and Technical Constraints](#14-risks-and-technical-constraints)

---

## 1. Revised MVP Scope

### 1.1 Approved Decisions (from Technical Review)

| Decision | Implementation |
|----------|----------------|
| **Monorepo packages** | 4 packages: `core`, `mcp-server`, `cli`, `shared` + internal `providers/` directory |
| **Core Engine** | Independent library (`@sre-studio/core`) shared by MCP Server and CLI |
| **MCP Server** | Thin transport layer (stdio only for MVP), delegates all logic to Core |
| **MCP Tools** | 8 tools with versioned JSON Schemas in `@sre-studio/shared/schemas/` |
| **Providers (MVP)** | Rizin (binary), JADX + apktool (Android) |
| **Evidence Engine** | SQLite with FK enforcement, migrations, queryable confidence, normalized environments, provenance |
| **Authorization** | Centralized in Core Engine at tool entry points |
| **Read-only default** | Enforced; no dynamic execution in MVP |
| **Transport** | stdio only; abstraction extensible for HTTP/SSE later |
| **Agent compatibility** | Claude Code ✅, Cursor ✅, Codex CLI ✅ (current MCP support) |
| **External tools** | Optional, independently managed; `doctor` validates, npm does not install |
| **Deferred** | JS bundler analysis, .NET, runtime instrumentation, workflow engine, docs site |
| **Windows-first** | Primary development target; paths, diagnostics, install scripts for Windows |
| **Clean-room philosophy** | Enforced via authorization model and evidence-first workflow |

### 1.2 MVP Success Criteria

- [ ] `npm install -g @sre-studio/cli` works on Windows/macOS/Linux
- [ ] `sre-studio init test-proj --target ./sample.apk --type android` creates project with auth record
- [ ] `sre-studio analyze tgt_123 --capability android.manifest` produces findings with evidence, confidence, provenance
- [ ] `sre-studio doctor` validates Rizin/JADX/apktool installed and on PATH
- [ ] Claude Code connects via MCP stdio, runs `investigation.start` → `analysis.run` → `evidence.query`
- [ ] SQLite DB has sessions, targets, findings with FK enforcement, confidence columns, environment normalization
- [ ] Authorization enforced: cannot analyze target without valid auth record
- [ ] CI passes: unit tests, integration test (MCP tool contracts), provider tests (fixture APK/binary)

---

## 2. Current Repository Assessment

### 2.1 What Exists (Verified Implementation)

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Master Skill (discoverable) | ✅ Complete | `.claude/skills/software-reverse-engineering-studio/SKILL.md` | Single entry point, coordinates internal modules |
| Internal Specialist References | ✅ Complete (8 modules) | `.claude/skills/software-reverse-engineering-studio/references/` | 5 analysis + 3 human-centered design |
| Skill Validation Script | ✅ Complete | `scripts/validate_pack.py` | Checks structure, frontmatter, secrets |
| Project Scaffold Script | ✅ Complete | `scripts/new_project.py` | Creates workspace with docs/src/tests/artifacts |
| Template: Decision Log | ✅ Complete | `.claude/skills/.../templates/decision-log.md` | Table format |
| Template: Delivery Report | ✅ Complete | `.claude/skills/.../templates/delivery-report.md` | Basic sections |
| Template: Project Brief | ✅ Complete | `.claude/skills/.../templates/project-brief.yaml` | YAML structure |
| Documentation | ✅ Complete | `README.md`, `README_BN.md`, `AGENTS.md`, `CHANGELOG.md`, `CONSOLIDATION_MAP.md` | Professional README redesigned |
| Asset Banner | ✅ Present | `assets/software-reverse-engineering-studio-banner.png` | 1.8MB PNG |

### 2.2 What Does Not Exist (Missing Capabilities)

| Capability | Status | Gap |
|------------|--------|-----|
| **Core Engine** | ❌ Missing | No investigation orchestration, session management, tool abstraction, capability registry |
| **MCP Server** | ❌ Missing | No MCP-compatible server, no structured tool definitions, no evidence-backed responses |
| **CLI** | ❌ Missing | No CLI binary, no project init, target registration, analysis commands, evidence inspection, report generation |
| **Evidence Engine** | ❌ Missing | No structured evidence model, no finding IDs, no confidence tracking, no reproducibility metadata |
| **Provider Integrations** | ❌ Missing | No Rizin, JADX, apktool integrations — only conceptual references in skill playbooks |
| **Agent Integration Layer** | ❌ Missing | Only skill-based (Claude Code/OpenCode) — no MCP client support |
| **TypeScript Codebase** | ❌ Missing | Entirely Python scripts + Markdown — no compiled/checked core |
| **Test Infrastructure** | ❌ Missing | No unit tests, integration tests, or validation of analysis capabilities |
| **Package Management** | ❌ Missing | No package.json, no monorepo structure, no npm/pnpm workspace |
| **Installation Experience** | ❌ Missing | Manual copy-paste skill installation only — no npx/npm-style workflow |

### 2.3 Architecture Classification

**Current:** Skill-oriented, agent-coupled, documentation-first, Python scripts + Markdown references
**Target (MVP):** Platform-oriented, agent-native (MCP), evidence-first, TypeScript core library with 2 internal providers

### 2.4 Technical Debt & Incomplete Items

- `scripts/validate_pack.py` only validates skill structure — does not verify tool availability or analysis capability
- `scripts/new_project.py` creates empty directories — no actual project initialization with configuration
- Reference modules are playbooks for LLM agents, not executable capability providers
- No versioning strategy for the platform itself (only CHANGELOG for skill package)
- No CI/CD pipeline
- No dependency management

---

## 3. Proposed System Architecture

### 3.1 High-Level Architecture (MVP)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AGENT CLIENTS (MCP)                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                         │
│  │ Claude Code │  │   Cursor    │  │  Codex CLI  │                         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                         │
└─────────┼────────────────┼────────────────┼─────────────────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MCP SERVER (@sre-studio/mcp-server)                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Transport: stdio (JSON-RPC 2.0)                  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │   │
│  │  │ Investigation│ │   Target    │ │  Evidence   │ │  Analysis   │  │   │
│  │  │   Tools (3) │ │   Tools (2) │ │   Tools (1) │ │   Tools (2) │  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │   │
│  │                         │                                       │   │
│  │              Thin adapters → delegate to Core Engine             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                    Core Engine Library (@sre-studio/core)
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Session Manager  │  │ Capability       │  │ Evidence Engine  │
│ (SQLite)         │  │ Registry         │  │ (Findings,       │
│                  │  │ (Providers)      │  │  Confidence,     │
└──────────────────┘  └──────────────────┘  │  Provenance)     │
         ▲                       ▲           └──────────────────┘
         │                       │                    │
         ▼                       ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Authorization    │  │ Provider:        │  │ Provider:        │
│ Manager          │  │ Binary (Rizin)   │  │ Android (JADX/   │
│ (enforced at     │  │ - binary.info    │  │ apktool)         │
│  tool entry)     │  │ - binary.symbols │  │ - android.manifest
└──────────────────┘  │ - binary.strings │  │ - android.perms
                      │ - binary.sections │  │ - android.resources
                      │ - binary.imports  │  │ - android.dex
                      │ - binary.cfg      │  │ - android.signing
                      └──────────────────┘  └──────────────────┘
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │   STORAGE (SQLite)   │
                      │  - sessions          │
                      │  - targets           │
                      │  - findings          │
                      │  - environments      │
                      │  - evidence_refs     │
                      │  - provenance        │
                      └──────────────────────┘
```

### 3.2 Component Interactions

1. **Agent → MCP Server**: Standard MCP protocol (JSON-RPC 2.0 over stdio)
2. **MCP Server → Core Engine**: Direct TypeScript calls (async/await), no process boundary
3. **Core Engine → Providers**: Capability interface (defined contracts, not concrete impls)
4. **Providers → External Tools**: Process spawning (Rizin, JADX, apktool) via Node `child_process`
5. **All Layers → Storage**: Core Engine owns SQLite; providers never access DB directly

### 3.3 Data Flow: Investigation Lifecycle

```
User Request (Agent)
    │
    ▼
MCP Tool: investigation.start({ target, scope, authorization })
    │
    ▼
Core Engine: Create Session → Validate Authorization → Register Target → Persist
    │
    ▼
MCP Response: { sessionId, status, targetId }
    │
    ▼
MCP Tool: analysis.run({ sessionId, capabilityId, parameters })
    │
    ▼
Core Engine: Check Authorization → Resolve Provider → Execute Analysis
    │
    ▼
Provider: Spawn Tool → Parse Output → Build Findings with Evidence + Provenance
    │
    ▼
Evidence Engine: Assign IDs → Calculate Confidence → Persist (FK-enforced)
    │
    ▼
MCP Response: { findings[], summary, statistics }
    │
    ▼
MCP Tool: evidence.query({ sessionId, filter, pagination })
    │
    ▼
MCP Response: { findings[], total }
    │
    ▼
MCP Tool: investigation.close({ sessionId }) → Final Report Generation
```

---

## 4. Proposed Directory Tree (MVP)

```
software-reverse-engineering-studio/
├── .github/
│   └── workflows/
│       ├── ci.yml              # CI: lint, typecheck, test, build
│       └── release.yml         # Release automation (manual trigger)
├── .vscode/
│   ├── settings.json
│   ├── launch.json
│   └── tasks.json
├── docs/
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── core-engine.md
│   │   ├── mcp-server.md
│   │   ├── cli.md
│   │   ├── evidence-model.md
│   │   ├── provider-sdk.md
│   │   └── security-model.md
│   ├── guides/
│   │   ├── installation.md
│   │   ├── quick-start.md
│   │   ├── mcp-configuration.md
│   │   ├── provider-setup/
│   │   │   ├── rizin.md
│   │   │   ├── jadx.md
│   │   │   └── apktool.md
│   │   └── agent-integration/
│   │       ├── claude-code.md
│   │       ├── cursor.md
│   │       └── codex-cli.md
│   ├── reference/
│   │   ├── mcp-tools.md
│   │   ├── cli-commands.md
│   │   ├── evidence-schema.md
│   │   └── capability-matrix.md
│   └── examples/
│       ├── binary-analysis.md
│       └── apk-analysis.md
├── packages/
│   ├── core/                    # @sre-studio/core
│   │   ├── src/
│   │   │   ├── engine/
│   │   │   │   ├── session-manager.ts
│   │   │   │   ├── capability-registry.ts
│   │   │   │   └── index.ts
│   │   │   ├── evidence/
│   │   │   │   ├── evidence-engine.ts
│   │   │   │   ├── finding.ts
│   │   │   │   ├── confidence.ts
│   │   │   │   ├── provenance.ts
│   │   │   │   └── index.ts
│   │   │   ├── storage/
│   │   │   │   ├── repository.ts
│   │   │   │   ├── sqlite-adapter.ts
│   │   │   │   ├── migrations/
│   │   │   │   │   ├── 001_initial_schema.ts
│   │   │   │   │   └── migrator.ts
│   │   │   │   └── index.ts
│   │   │   ├── security/
│   │   │   │   ├── authorization.ts
│   │   │   │   ├── boundaries.ts
│   │   │   │   ├── audit.ts
│   │   │   │   └── index.ts
│   │   │   ├── providers/
│   │   │   │   ├── capability-provider.ts
│   │   │   │   ├── provider-registry.ts
│   │   │   │   └── index.ts
│   │   │   ├── types/
│   │   │   │   ├── investigation.ts
│   │   │   │   ├── target.ts
│   │   │   │   ├── evidence.ts
│   │   │   │   ├── provider.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── mcp-server/              # @sre-studio/mcp-server
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── tools/
│   │   │   │   ├── investigation-tools.ts
│   │   │   │   ├── target-tools.ts
│   │   │   │   ├── evidence-tools.ts
│   │   │   │   ├── analysis-tools.ts
│   │   │   │   └── index.ts
│   │   │   ├── validation/
│   │   │   │   ├── schemas.ts
│   │   │   │   └── validators.ts
│   │   │   ├── transport/
│   │   │   │   ├── stdio.ts
│   │   │   │   └── transport.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── cli/                     # @sre-studio/cli (sre-studio)
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── init.ts
│   │   │   │   ├── target.ts
│   │   │   │   ├── analyze.ts
│   │   │   │   ├── investigate.ts
│   │   │   │   ├── evidence.ts
│   │   │   │   ├── report.ts
│   │   │   │   ├── provider.ts
│   │   │   │   ├── doctor.ts
│   │   │   │   └── index.ts
│   │   │   ├── config/
│   │   │   │   ├── global.ts
│   │   │   │   ├── project.ts
│   │   │   │   └── index.ts
│   │   │   ├── output/
│   │   │   │   ├── formatter.ts
│   │   │   │   └── reporter.ts
│   │   │   ├── agent-config/
│   │   │   │   ├── generator.ts
│   │   │   │   ├── templates/
│   │   │   │   │   ├── claude-code.mcp.json.hbs
│   │   │   │   │   ├── cursor.mcp.json.hbs
│   │   │   │   │   └── codex-cli.mcp.json.hbs
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── shared/                  # @sre-studio/shared
│   │   ├── src/
│   │   │   ├── constants.ts
│   │   │   ├── errors.ts
│   │   │   ├── utils.ts
│   │   │   └── schemas/
│   │   │       ├── mcp-tools/
│   │   │       │   ├── investigation.start.json
│   │   │       │   ├── investigation.status.json
│   │   │       │   ├── investigation.close.json
│   │   │       │   ├── target.register.json
│   │   │       │   ├── target.list.json
│   │   │       │   ├── analysis.run.json
│   │   │       │   ├── analysis.capabilities.json
│   │   │       │   └── evidence.query.json
│   │   │       ├── investigation.json
│   │   │       ├── target.json
│   │   │       ├── evidence.json
│   │   │       └── provider.json
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── providers/               # Internal provider implementations (not published)
│       ├── binary/              # Rizin provider
│       │   ├── src/
│       │   │   ├── rizin-provider.ts
│       │   │   ├── binary-capabilities.ts
│       │   │   ├── parsers/
│       │   │   │   ├── info-parser.ts
│       │   │   │   ├── symbols-parser.ts
│       │   │   │   ├── strings-parser.ts
│       │   │   │   ├── sections-parser.ts
│       │   │   │   ├── imports-parser.ts
│       │   │   │   └── cfg-parser.ts
│       │   │   └── index.ts
│       │   ├── tests/
│       │   ├── fixtures/
│       │   ├── package.json
│       │   └── tsconfig.json
│       └── android/             # JADX + apktool provider
│           ├── src/
│           │   ├── jadx-provider.ts
│           │   ├── apktool-provider.ts
│           │   ├── android-capabilities.ts
│           │   ├── parsers/
│           │   │   ├── manifest-parser.ts
│           │   │   ├── permissions-parser.ts
│           │   │   ├── resources-parser.ts
│           │   │   ├── dex-parser.ts
│           │   │   └── signing-parser.ts
│           │   └── index.ts
│           ├── tests/
│           ├── fixtures/
│           ├── package.json
│           └── tsconfig.json
├── tools/
│   └── validate-structure.ts    # Replaces validate_pack.py
├── tests/
│   ├── integration/
│   │   ├── mcp-server.test.ts
│   │   ├── cli.test.ts
│   │   └── core-engine.test.ts
│   ├── fixtures/
│   │   ├── sample-binaries/
│   │   │   ├── hello.elf
│   │   │   ├── hello.exe
│   │   │   └── stripped.elf
│   │   └── sample-apks/
│   │       ├── simple.apk
│   │       ├── multi-dex.apk
│   │       └── obfuscated.apk
│   └── e2e/
│       └── investigation-flow.test.ts
├── scripts/
│   ├── install-providers.ps1    # Windows provider installer
│   ├── install-providers.sh     # Unix provider installer
│   ├── dev-setup.ps1
│   ├── dev-setup.sh
│   └── release.ts
├── package.json                 # Root pnpm workspace
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
└── .gitignore
```

---

## 5. Package and Module Responsibilities

### 5.1 @sre-studio/core (Core Engine Library)

**Responsibility:** Investigation orchestration, session management, capability registry, evidence engine, authorization enforcement, storage abstraction.

**Key Exports:**
- `SessionManager` — Create, resume, close investigation sessions; persists to SQLite
- `CapabilityRegistry` — Register, discover, resolve providers by capability ID
- `EvidenceEngine` — Structure findings, calculate confidence, track provenance, persist
- `AuthorizationManager` — Validate authorization at tool entry points, enforce boundaries, audit log
- `Storage` — SQLite repository with migrations, FK enforcement, connection pooling
- `Types` — All shared interfaces (investigation, target, evidence, provider)

**Dependencies:** `@sre-studio/shared`, `@sre-studio/providers` (interface only via `capability-provider.ts`)

**Not Responsible For:** MCP protocol, CLI parsing, HTTP transport, external tool execution

### 5.2 @sre-studio/mcp-server (Thin Transport Layer)

**Responsibility:** MCP protocol compliance (stdio), tool exposure, request/response validation, delegation to Core Engine.

**Key Exports:**
- `createMcpServer()` — Factory returning MCP server instance
- 8 tool handlers (thin adapters calling Core Engine)
- JSON Schema validators for all tool I/O
- Stdio transport implementation

**Dependencies:** `@sre-studio/core`, `@sre-studio/shared`, `@modelcontextprotocol/sdk`

**Not Responsible For:** Session persistence, evidence storage, provider logic, authorization decisions (delegates to Core)

### 5.3 @sre-studio/cli (User-Facing Command Interface)

**Responsibility:** Project initialization, local investigation management, report generation, provider configuration, environment diagnostics, agent config generation.

**Commands:**
| Command | Description |
|---------|-------------|
| `sre-studio init [name]` | Initialize new investigation project |
| `sre-studio target add <path\|url>` | Register analysis target |
| `sre-studio target list` | List registered targets |
| `sre-studio analyze <target> --capability <name>` | Run single capability analysis |
| `sre-studio investigate <session>` | Interactive investigation session |
| `sre-studio evidence <session>` | Inspect evidence database |
| `sre-studio report <session> --format <json\|md\|html>` | Generate report |
| `sre-studio provider list` | List available/configured providers |
| `sre-studio provider status <name>` | Check provider health |
| `sre-studio doctor` | Environment diagnostics |
| `sre-studio agent-config <agent>` | Generate MCP config for agent |

**Dependencies:** `@sre-studio/core`, `@sre-studio/shared`, `commander`, `chalk`, `ora`, `handlebars` (for agent config templates)

**Not Responsible For:** MCP protocol, server lifecycle

### 5.4 @sre-studio/shared (Shared Types, Schemas, Utilities)

**Responsibility:** Common types, error classes, JSON Schemas for all MCP tools and data models, constants, utilities.

**Key Exports:**
- TypeScript interfaces matching JSON Schemas
- JSON Schema files (`.json`) for all 8 MCP tools
- Error classes: `AuthorizationError`, `ProviderError`, `ValidationError`, `NotFoundError`
- Utility functions: ID generation, hashing, path normalization

### 5.5 Internal Providers (`packages/providers/`)

**Responsibility:** Implement `CapabilityProvider` interface for specific analysis domains. Not published to npm; bundled with CLI/MCP server.

**Provider Interface (in `@sre-studio/core/providers/capability-provider.ts`):**
```typescript
interface CapabilityProvider {
  readonly id: string;           // e.g., "rizin", "jadx-apktool"
  readonly name: string;
  readonly version: string;
  readonly capabilities: ReadonlyArray<ProviderCapability>;
  readonly requiredTools: ReadonlyArray<ExternalToolDependency>;

  initialize(config: ProviderConfig): Promise<InitializationResult>;
  validateEnvironment(): Promise<EnvironmentValidationResult>;
  analyze(request: AnalysisRequest): Promise<AnalysisResult>;
  shutdown(): Promise<void>;
}

interface ProviderCapability {
  id: string;                    // e.g., "binary.symbols", "android.manifest"
  name: string;
  description: string;
  category: 'static-analysis' | 'extraction' | 'parsing';
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
}

interface ExternalToolDependency {
  name: string;                  // "rizin", "jadx", "apktool"
  versionConstraint: string;     // semver range
  verifyCommand: string;         // e.g., "rizin -v", "jadx --version"
  installHint: string;           // Platform-specific install guidance
}
```

**MVP Providers:**
- **Binary (Rizin)** — `rizin`, `rabin2`, `rz-pipe`; capabilities: `binary.info`, `binary.symbols`, `binary.strings`, `binary.sections`, `binary.imports`, `binary.cfg`
- **Android (JADX + apktool)** — `jadx`, `apktool`, `aapt2`; capabilities: `android.manifest`, `android.permissions`, `android.resources`, `android.dex`, `android.signing`

---

## 6. MCP Server Design

### 6.1 Protocol Compliance

- **Transport:** stdio only (JSON-RPC 2.0)
- **Protocol Version:** MCP 2025-06-18 (current stable)
- **Capabilities:** `tools` only (MVP); `resources`/`prompts` deferred
- **Server Name:** `sre-studio`

### 6.2 Tool Catalog (8 Tools with Versioned JSON Schemas)

All schemas defined in `@sre-studio/shared/schemas/mcp-tools/*.json` with `$id` and `version`.

#### Investigation Tools (3)

| Tool | Input Schema | Output Schema |
|------|--------------|---------------|
| `investigation.start` | `investigation.start.json` | `investigation.start.result.json` |
| `investigation.status` | `investigation.status.json` | `investigation.status.result.json` |
| `investigation.close` | `investigation.close.json` | `investigation.close.result.json` |

#### Target Tools (2)

| Tool | Input Schema | Output Schema |
|------|--------------|---------------|
| `target.register` | `target.register.json` | `target.register.result.json` |
| `target.list` | `target.list.json` | `target.list.result.json` |

#### Analysis Tools (2)

| Tool | Input Schema | Output Schema |
|------|--------------|---------------|
| `analysis.run` | `analysis.run.json` | `analysis.run.result.json` |
| `analysis.capabilities` | `analysis.capabilities.json` | `analysis.capabilities.result.json` |

#### Evidence Tools (1)

| Tool | Input Schema | Output Schema |
|------|--------------|---------------|
| `evidence.query` | `evidence.query.json` | `evidence.query.result.json` |

### 6.3 Tool Contracts (Summary)

#### `investigation.start`
```json
// Input
{
  "target": { "type": "binary|android", "path": "string", "hash": "string?" },
  "scope": "string",
  "authorization": { "type": "owner|explicit-permission|public", "description": "string", "documentRef": "string?" },
  "config": { "providers": "string[]?" }
}

// Output
{
  "sessionId": "ses_...",
  "targetId": "tgt_...",
  "status": "initialized",
  "capabilities": ["binary.info", "android.manifest", ...]
}
```

#### `analysis.run`
```json
// Input
{
  "sessionId": "ses_...",
  "capabilityId": "binary.symbols",
  "parameters": { "includeImports": true }
}

// Output
{
  "findings": [
    {
      "id": "fnd_...",
      "title": "string",
      "observation": "string",
      "inference": "string?",
      "category": "structure|code|data|...",
      "severity": "info|low|medium|high|critical",
      "confidence": { "level": "high|medium|low|none", "value": 0.95, "justification": "string" },
      "evidence": [{ "type": "tool-output", "location": {...}, "excerpt": "string", "hash": "string" }],
      "provenance": { "derivedFrom": ["fnd_..."], "tool": "rizin", "command": "rizin -c 'is' ..." }
    }
  ],
  "summary": "string",
  "statistics": { "byCategory": {...}, "bySeverity": {...}, "avgConfidence": 0.87 }
}
```

#### `evidence.query`
```json
// Input
{
  "sessionId": "ses_...",
  "filter": { "category": "code", "confidenceMin": 0.7, "capabilityId": "binary.symbols" },
  "pagination": { "limit": 50, "offset": 0 }
}

// Output
{
  "findings": [...],
  "total": 127,
  "hasMore": true
}
```

### 6.4 Input/Output Validation

- All tool inputs validated against JSON Schema (draft-2020-12) via AJV
- All tool outputs conform to defined response schemas
- Errors follow standard format: `{ code, message, details?, retryable: boolean }`
- Error codes: `AUTHORIZATION_DENIED`, `PROVIDER_UNAVAILABLE`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `TARGET_NOT_FOUND`, `SESSION_NOT_FOUND`

### 6.5 Session Management

- Session ID (`ses_${uuid}`) propagated through all tool calls
- Core Engine owns session state; MCP Server is stateless
- Sessions persisted to SQLite automatically on every state change
- Concurrent sessions supported (configurable limit, default 10)

---

## 7. CLI Command Design

### 7.1 Command Structure

```
sre-studio <command> [subcommand] [options] [arguments]
```

### 7.2 Global Options

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Config file path (default: `~/.sre-studio/config.yaml`) |
| `-w, --workspace <path>` | Workspace directory (default: cwd) |
| `--json` | Output as JSON |
| `--quiet` | Suppress non-error output |
| `--verbose` | Verbose logging |
| `--no-color` | Disable colored output |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

### 7.3 Command Specifications

#### `sre-studio init [name]`
```bash
# Interactive
sre-studio init my-investigation

# Non-interactive
sre-studio init my-investigation --target ./app.apk --type android --auth-type owner --scope "full analysis"
```

**Options:**
- `-t, --type <binary|android>` — Target type
- `--target <path>` — Initial target path/URL
- `--auth-type <owner|explicit-permission|public>` — Authorization type
- `--scope <string>` — Analysis scope description
- `--auth-doc <path>` — Authorization document reference
- `--force` — Overwrite existing directory

#### `sre-studio target add <path|url>`
```bash
sre-studio target add ./app.exe --type binary --auth-type owner --scope "vulnerability research"
```

**Options:**
- `--type <binary|android>` — Target type
- `--auth-type <owner|explicit-permission|public>` — Authorization type
- `--scope <string>` — Analysis scope
- `--session <id>` — Attach to existing session (default: new session)

#### `sre-studio analyze <targetId>`
```bash
sre-studio analyze tgt_123 --capability binary.symbols
sre-studio analyze tgt_123 --capability android.manifest --output ./results --format json
```

**Options:**
- `--capability <id>` — Specific capability to run
- `--all` — Run all applicable capabilities
- `--output <path>` — Output directory
- `--format <json|yaml|markdown|table>` — Output format
- `--session <id>` — Attach to existing session

#### `sre-studio investigate <sessionId>`
```bash
# Interactive REPL
sre-studio investigate ses_456

# Non-interactive workflow
sre-studio investigate ses_456 --workflow full-binary
```

**Options:**
- `--workflow <name>` — Predefined workflow (`full-binary`, `apk-security`, `binary-recon`)
- `--interactive` / `--no-interactive` — REPL mode

#### `sre-studio evidence <sessionId>`
```bash
sre-studio evidence ses_456 --filter "confidence>0.8 and category=code"
sre-studio evidence ses_456 --finding fnd_789 --format json
sre-studio evidence ses_456 --export ./evidence-bundle
```

**Options:**
- `--filter <expression>` — Filter findings (SQL-like syntax)
- `--finding <id>` — Show single finding with full provenance
- `--export <path>` — Export evidence bundle (JSONL)
- `--format <json|table|markdown>` — Output format

#### `sre-studio report <sessionId>`
```bash
sre-studio report ses_456 --format markdown --output ./report.md
sre-studio report ses_456 --format json --include-evidence
sre-studio report ses_456 --format html --template technical
```

**Options:**
- `--format <markdown|html|json|sarif>` — Report format
- `--template <name>` — Report template (`technical`, `executive`, `compliance`)
- `--output <path>` — Output file
- `--include-evidence` — Embed full evidence
- `--confidence-threshold <0-1>` — Minimum confidence

#### `sre-studio provider <subcommand>`
```bash
sre-studio provider list
sre-studio provider status rizin
sre-studio provider configure rizin --path "C:\tools\rizin"
```

**Subcommands:** `list`, `status`, `configure`

#### `sre-studio doctor`
```bash
sre-studio doctor
sre-studio doctor --provider rizin
sre-studio doctor --fix
```

**Options:**
- `--provider <name>` — Check specific provider
- `--fix` — Attempt auto-fix (PATH, config)
- `--json` — Machine-readable output

#### `sre-studio agent-config <agent>`
```bash
sre-studio agent-config claude-code --output .mcp.json
sre-studio agent-config cursor
sre-studio agent-config codex-cli
```

**Options:**
- `--output <path>` — Output file (default: stdout)

---

## 8. Evidence Data Model

### 8.1 Core Types (TypeScript + JSON Schema)

```typescript
// Branded ID types
type FindingId = `fnd_${string}`;
type SessionId = `ses_${string}`;
type TargetId = `tgt_${string}`;
type ProviderId = `prv_${string}`;
type EnvironmentId = `env_${string}`;

// Confidence with justification
interface ConfidenceScore {
  level: 'high' | 'medium' | 'low' | 'none';
  value: number;                    // 0.0 - 1.0
  justification: string;
  factors: ConfidenceFactor[];
}

interface ConfidenceFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
  weight: number;                   // 0.0 - 1.0
}

// Evidence reference to source
interface EvidenceReference {
  id: string;
  type: 'file' | 'memory' | 'network' | 'tool-output' | 'observation';
  location: SourceLocation;
  excerpt?: string;
  hash?: string;                    // SHA-256 of excerpt/content
  timestamp: string;                // ISO 8601
  tool?: string;
}

interface SourceLocation {
  file?: string;
  offset?: number;
  length?: number;
  address?: string;                 // Memory address
  function?: string;
  line?: number;
  column?: number;
  url?: string;
  packet?: number;
}

// Provenance: how this finding was derived
interface ProvenanceInfo {
  derivedFrom: FindingId[];         // Parent findings
  tool: string;                     // e.g., "rizin", "jadx"
  command: string;                  // Exact command executed
  parameters: Record<string, unknown>;
  duration: number;                 // ms
  toolVersion: string;
}

// Reproducibility
interface ReproducibilityInfo {
  reproducible: boolean;
  environmentId: EnvironmentId;     // Reference to normalized environment
  steps: ReproductionStep[];
  knownVariations: Variation[];
}

interface ReproductionStep {
  order: number;
  action: string;
  tool: string;
  parameters: Record<string, unknown>;
  expectedOutcome: string;
}

interface Variation {
  condition: string;
  effectOnFinding: 'none' | 'minor' | 'major' | 'invalidates';
}

// Normalized environment (shared across findings)
interface EnvironmentSnapshot {
  id: EnvironmentId;
  os: string;
  arch: string;
  tools: ToolVersion[];
  providerVersions: Record<string, string>;
  targetHash: string;
  capturedAt: string;
}

interface ToolVersion {
  name: string;
  version: string;
  path: string;
}

// Main finding record
interface Finding {
  id: FindingId;
  sessionId: SessionId;
  targetId: TargetId;
  providerId: ProviderId;
  capabilityId: string;

  // Classification
  category: FindingCategory;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  tags: string[];

  // Content
  title: string;
  observation: string;              // What was observed (fact)
  inference?: string;               // What is inferred (hypothesis) - clearly separated
  evidence: EvidenceReference[];

  // Quality
  confidence: ConfidenceScore;
  limitations: string[];
  unknowns: string[];
  provenance: ProvenanceInfo;
  reproducibility: ReproducibilityInfo;

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;                // Tool/agent identifier
  version: number;
}

type FindingCategory = 
  | 'structure'       // File format, sections, components
  | 'behavior'        // Observed runtime behavior
  | 'code'            // Decompiled/disassembled code
  | 'data'            // Extracted data, strings, resources
  | 'network'         // Network communication
  | 'security'        // Security-relevant finding
  | 'configuration'   // Config, manifest, settings
  | 'dependency'      // External dependencies
  | 'anomaly'         // Unexpected/unusual observation
  | 'other';
```

### 8.2 Session & Investigation Models

```typescript
interface InvestigationSession {
  id: SessionId;
  projectId: string;
  name: string;
  description?: string;
  targets: TargetReference[];
  authorization: AuthorizationRecord;
  status: 'initialized' | 'running' | 'paused' | 'completed' | 'failed' | 'archived';
  progress: SessionProgress;
  config: SessionConfig;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  tags: string[];
}

interface SessionProgress {
  totalSteps: number;
  completedSteps: number;
  currentStep?: string;
  findingsCount: number;
  evidenceCount: number;
  errors: SessionError[];
}

interface TargetReference {
  targetId: TargetId;
  role: 'primary' | 'secondary' | 'reference';
  addedAt: string;
}

interface AuthorizationRecord {
  type: 'owner' | 'explicit-permission' | 'public' | 'authorized-testing';
  description: string;
  grantedBy?: string;
  grantedAt?: string;
  scope: string[];
  limitations: string[];
  documentReference?: string;
  verified: boolean;
}
```

### 8.3 Storage Schema (SQLite with FK Enforcement)

```sql
-- Enable foreign keys
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Schema version tracking
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);

-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('initialized','running','paused','completed','failed','archived')),
  config_json TEXT NOT NULL,
  authorization_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  tags_json TEXT
);

-- Targets
CREATE TABLE targets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('binary','android','web','js','dotnet','network')),
  path TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  hashes_json TEXT NOT NULL,
  authorization_json TEXT NOT NULL,
  added_at TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('primary','secondary','reference')),
  UNIQUE(session_id, path)
);

-- Environments (normalized, shared across findings)
CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  provider_versions_json TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

-- Findings (Evidence) - queryable confidence fields
CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  title TEXT NOT NULL,
  observation TEXT NOT NULL,
  inference TEXT,
  evidence_json TEXT NOT NULL,
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('high','medium','low','none')),
  confidence_value REAL NOT NULL CHECK (confidence_value >= 0.0 AND confidence_value <= 1.0),
  confidence_justification TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  unknowns_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  reproducibility_json TEXT NOT NULL,
  tags_json TEXT,
  environment_id TEXT REFERENCES environments(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

-- Indexes for common queries
CREATE INDEX idx_findings_session ON findings(session_id);
CREATE INDEX idx_findings_target ON findings(target_id);
CREATE INDEX idx_findings_category ON findings(category);
CREATE INDEX idx_findings_confidence ON findings(confidence_level, confidence_value);
CREATE INDEX idx_findings_capability ON findings(capability_id);
CREATE INDEX idx_findings_created ON findings(created_at);
CREATE INDEX idx_targets_session ON targets(session_id);
CREATE INDEX idx_environments_session ON environments(session_id);
```

### 8.4 Migration System

```typescript
// packages/core/src/storage/migrations/migrator.ts
interface Migration {
  version: number;
  description: string;
  up: (db: Database) => Promise<void>;
  down?: (db: Database) => Promise<void>;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema',
    up: async (db) => { /* run schema above */ }
  }
  // Future migrations added here
];

export async function migrate(db: Database): Promise<void> {
  const current = db.prepare('SELECT MAX(version) as v FROM schema_version').get()?.v ?? 0;
  for (const m of migrations.filter(m => m.version > current)) {
    await m.up(db);
    db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(m.version, m.description);
  }
}
```

---

## 9. Provider Abstraction Design

### 9.1 Capability Provider Interface (Core)

```typescript
// packages/core/src/providers/capability-provider.ts
export interface CapabilityProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities: ReadonlyArray<ProviderCapability>;
  readonly requiredTools: ReadonlyArray<ExternalToolDependency>;

  initialize(config: ProviderConfig): Promise<InitializationResult>;
  validateEnvironment(): Promise<EnvironmentValidationResult>;
  analyze(request: AnalysisRequest): Promise<AnalysisResult>;
  shutdown(): Promise<void>;
}

export interface ProviderCapability {
  id: string;
  name: string;
  description: string;
  category: 'static-analysis' | 'extraction' | 'parsing';
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  estimatedDurationMs?: number;
}

export interface ExternalToolDependency {
  name: string;
  versionConstraint: string;
  verifyCommand: string;
  installHint: Record<'win32' | 'darwin' | 'linux', string>;
}

export interface ProviderConfig {
  toolPaths?: Record<string, string>;
  maxMemoryMb?: number;
  timeoutMs?: number;
  settings?: Record<string, unknown>;
  cacheDir?: string;
  enableCache?: boolean;
}

export interface AnalysisRequest {
  sessionId: SessionId;
  targetId: TargetId;
  capabilityId: string;
  parameters: Record<string, unknown>;
  context?: AnalysisContext;
}

export interface AnalysisContext {
  priorFindings?: FindingId[];
  targetMetadata?: Record<string, unknown>;
  hints?: Record<string, unknown>;
}

export interface AnalysisResult {
  findings: Finding[];
  summary: string;
  statistics: AnalysisStatistics;
  duration: number;
  toolOutputs: ToolOutput[];
  warnings: string[];
  errors: AnalysisError[];
}
```

### 9.2 Provider Registry (Core)

```typescript
// packages/core/src/providers/provider-registry.ts
export class ProviderRegistry {
  private providers = new Map<ProviderId, CapabilityProvider>();

  register(provider: CapabilityProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider ${provider.id} already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: ProviderId): CapabilityProvider | undefined {
    return this.providers.get(id);
  }

  findByCapability(capabilityId: string): CapabilityProvider[] {
    return Array.from(this.providers.values()).filter(p =>
      p.capabilities.some(c => c.id === capabilityId)
    );
  }

  resolveBest(capabilityId: string, context?: ResolutionContext): CapabilityProvider | null {
    const candidates = this.findByCapability(capabilityId);
    if (candidates.length === 0) return null;
    // Prefer: initialized > validated > configured > first
    return candidates[0];
  }

  listCapabilities(): ProviderCapability[] {
    return Array.from(this.providers.values()).flatMap(p => p.capabilities);
  }

  async validateAll(): Promise<ValidationReport> {
    const results = await Promise.all(
      Array.from(this.providers.values()).map(async p => ({
        provider: p.id,
        valid: (await p.validateEnvironment()).valid,
        tools: p.requiredTools
      }))
    );
    return { providers: results, allValid: results.every(r => r.valid) };
  }
}
```

### 9.3 Base Provider Class (SDK for Custom Providers)

```typescript
// packages/core/src/providers/base-provider.ts
export abstract class BaseProvider implements CapabilityProvider {
  abstract readonly id: ProviderId;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly capabilities: ReadonlyArray<ProviderCapability>;
  abstract readonly requiredTools: ReadonlyArray<ExternalToolDependency>;

  protected config: ProviderConfig;
  protected logger: Logger;
  protected evidenceBuilder: EvidenceBuilder;

  async initialize(config: ProviderConfig): Promise<InitializationResult> {
    this.config = config;
    await this.validateTools();
    return this.doInitialize();
  }

  protected abstract doInitialize(): Promise<InitializationResult>;
  protected abstract doAnalyze(request: AnalysisRequest): Promise<AnalysisResult>;

  // Evidence construction helpers
  protected createFinding(input: FindingInput): Finding { ... }
  protected createEvidenceReference(input: EvidenceInput): EvidenceReference { ... }
  protected calculateConfidence(factors: ConfidenceFactor[]): ConfidenceScore { ... }

  // Tool execution
  protected async execTool(command: string, args: string[], options?: ExecOptions): Promise<ToolOutput> { ... }
  protected async spawnTool(command: string, args: string[], options?: SpawnOptions): Promise<ChildProcess> { ... }
}
```

### 9.4 MVP Provider Implementations

#### Binary Provider (Rizin)

| Capability | Tool | Command | Output Parsing |
|------------|------|---------|----------------|
| `binary.info` | `rabin2` | `rabin2 -Ij <file>` | JSON → structure, arch, bits, endian |
| `binary.symbols` | `rabin2` | `rabin2 -sj <file>` | JSON → symbols (imports/exports) |
| `binary.strings` | `rabin2` | `rabin2 -zj <file>` | JSON → strings with addresses |
| `binary.sections` | `rabin2` | `rabin2 -Sj <file>` | JSON → sections with permissions |
| `binary.imports` | `rabin2` | `rabin2 -ij <file>` | JSON → imported functions/libs |
| `binary.cfg` | `rizin` | `rizin -c 'agfj' <file>` | JSON → control flow graph |

**Confidence Factors:**
- Tool exit code = 0 → +0.3
- Output parses without errors → +0.3
- Known file format (ELF/PE/Mach-O) → +0.2
- Symbols present (not stripped) → +0.2

#### Android Provider (JADX + apktool)

| Capability | Tool | Command | Output Parsing |
|------------|------|---------|----------------|
| `android.manifest` | `apktool` | `apktool d -o <out> <apk>` → parse `AndroidManifest.xml` | XML → permissions, components, minSdk |
| `android.permissions` | `aapt2` | `aapt2 dump permissions <apk>` | Text → declared permissions |
| `android.resources` | `apktool` | `apktool d -o <out> <apk>` → scan `res/` | Directory → resource inventory |
| `android.dex` | `jadx` | `jadx -d <out> --export-gradle <apk>` | JSON/gradle → DEX summary, class count |
| `android.signing` | `apksigner` | `apksigner verify --print-certs <apk>` | Text → certificate chain |

**Confidence Factors:**
- Manifest parses → +0.4
- JADX decompiles classes → +0.3
- Resources extracted → +0.2
- Signing verified → +0.1

---

## 10. Agent Integration Strategy

### 10.1 Current MCP Compatibility (2025)

| Agent | MCP Support | Transport | Notes |
|-------|-------------|-----------|-------|
| **Claude Code** | ✅ Full | stdio | Native MCP client |
| **Cursor** | ✅ Full | stdio | Built-in MCP support |
| **Codex CLI** | ✅ Full | stdio | OpenAI Codex CLI supports MCP |

### 10.2 MCP Configuration Templates

Generated via `sre-studio agent-config <agent>`

```json
// claude-code.mcp.json
{
  "mcpServers": {
    "sre-studio": {
      "command": "sre-studio",
      "args": ["mcp"],
      "env": {
        "SRE_STUDIO_WORKSPACE": "${workspaceFolder}",
        "SRE_STUDIO_CONFIG": "${workspaceFolder}/.sre-studio/config.yaml"
      }
    }
  }
}
```

```json
// cursor.mcp.json
{
  "mcpServers": {
    "sre-studio": {
      "command": "sre-studio",
      "args": ["mcp"],
      "env": {}
    }
  }
}
```

```toml
# codex-cli.toml (append to ~/.codex/config.toml or .codex/config.toml)
# Or run: codex mcp add sre-studio --env SRE_STUDIO_WORKSPACE=. --env SRE_STUDIO_CONFIG=./.sre-studio/config.yaml -- sre-studio-mcp
[mcp_servers.sre-studio]
command = "sre-studio-mcp"
args = []
cwd = "."

[mcp_servers.sre-studio.env]
SRE_STUDIO_WORKSPACE = "."
SRE_STUDIO_CONFIG = "./.sre-studio/config.yaml"
```

### 10.3 Installation Helpers

```bash
# Auto-detect agent and configure
sre-studio agent-config --auto

# Generate for specific agent
sre-studio agent-config claude-code --output .mcp.json
sre-studio agent-config cursor
sre-studio agent-config codex-cli
```

---

## 11. Security and Authorization Model

### 11.1 Authorization Boundaries

```typescript
interface AuthorizationBoundary {
  allowedTargets: TargetPattern[];
  allowedCapabilities: CapabilityPattern[];
  requiresApproval: ApprovalRequired[];
  limits: ResourceLimits;
  dataHandling: DataHandlingPolicy;
}

interface TargetPattern {
  type: 'binary' | 'android' | '*';
  pathPattern?: string;
  hashAllowlist?: string[];
}

interface CapabilityPattern {
  provider?: string;
  capability?: string;
  category?: 'static-analysis' | 'extraction' | 'parsing';
}

type ApprovalRequired = 
  | 'dynamic-execution'
  | 'network-capture'
  | 'file-modification'
  | 'external-service'
  | 'credential-access'
  | 'high-resource-usage';

interface ResourceLimits {
  maxMemoryMb: number;
  maxCpuPercent: number;
  maxDurationMs: number;
  maxConcurrentAnalyses: number;
  maxDiskUsageMb: number;
}

interface DataHandlingPolicy {
  allowExternalTransmission: boolean;
  redactionRules: RedactionRule[];
  maxRetentionDays: number;
  encryptAtRest: boolean;
}
```

### 11.2 Centralized Enforcement (Core Engine)

```typescript
// packages/core/src/security/authorization.ts
export class AuthorizationManager {
  private boundaries: AuthorizationBoundary;

  constructor(boundaries: AuthorizationBoundary) {
    this.boundaries = boundaries;
  }

  async authorize(request: AuthorizedRequest): Promise<AuthorizationResult> {
    // 1. Check target permission
    const targetAuth = this.checkTargetAuthorization(request.targetId);
    
    // 2. Check capability permission
    const capabilityAuth = this.checkCapabilityAuthorization(request.capabilityId, request.targetId);
    
    // 3. Check operation approval requirements
    const approvalNeeded = this.checkApprovalRequired(request.operation);
    
    // 4. Check resource limits
    const resourceCheck = await this.checkResourceLimits(request);
    
    // 5. Audit log
    await this.auditLog({
      request,
      decision: targetAuth && capabilityAuth && resourceCheck ? 'allow' : 'deny',
      approvalNeeded,
      timestamp: new Date().toISOString()
    });

    return {
      allowed: targetAuth && capabilityAuth && resourceCheck,
      approvalNeeded,
      reason: targetAuth ? (capabilityAuth ? (resourceCheck ? null : 'resource-limit') : 'capability-denied') : 'target-denied',
      boundaries: this.boundaries
    };
  }

  // Called by Core Engine at EVERY tool entry point
  static middleware = async (request: AuthorizedRequest, next: () => Promise<any>) => {
    const auth = await authorizationManager.authorize(request);
    if (!auth.allowed) {
      throw new AuthorizationError(auth.reason!, auth.approvalNeeded);
    }
    return next();
  };
}
```

### 11.3 Clean-Room Workflow Enforcement

```typescript
// Enforced by platform for implementation tasks
interface CleanRoomWorkflow {
  evidenceCollection: {
    allowed: ['static-analysis', 'observation', 'documentation'];
    forbidden: ['code-copying', 'decompilation-to-source', 'asset-extraction-for-reuse'];
  };
  specification: {
    allowed: ['behavior-spec', 'interface-definition', 'architecture-design'];
    forbidden: ['implementation', 'code-generation'];
  };
  implementation: {
    allowed: ['original-code', 'stdlib', 'approved-dependencies'];
    forbidden: ['copied-code', 'proprietary-algorithms', 'extracted-assets'];
    verification: 'evidence-traceability';
  };
  validation: {
    required: ['functional-parity-tests', 'behavioral-verification', 'difference-documentation'];
    forbidden: ['claiming-identical-behavior-without-evidence'];
  };
}
```

### 11.4 Default Security Posture (MVP)

| Setting | Default | Enforcement |
|---------|---------|-------------|
| Read-only analysis | ✅ Enforced | Providers never write to target files |
| Network isolation | ✅ Enforced | No outbound connections in MVP |
| Credential handling | ✅ Redacted | Redaction in EvidenceEngine before persist |
| Dynamic execution | ❌ Not in MVP | No Frida/eBPF provider |
| External services | ❌ Not in MVP | No cloud APIs |
| Evidence encryption | ✅ At rest | SQLite + application-level encryption (Phase 2) |
| Audit logging | ✅ Enabled | All auth decisions logged to SQLite |

---

## 12. Testing Strategy

### 12.1 Test Pyramid (MVP)

```
                    ┌─────────────────┐
                    │   E2E Tests     │  (3-5) Full investigation flows
                    ├─────────────────┤
              ┌─────│ Integration     │─────┐
              │     │ Tests           │     │
              │     ├─────────────────┤     │
              │     │  Provider       │     │
    ┌─────────┘     │  Tests          │     └─────────┐
    │               ├─────────────────┤               │
    │               │    Unit Tests   │               │
    │               │  (per package)  │               │
    └───────────────┴─────────────────┴───────────────┘
```

### 12.2 Test Categories

| Category | Scope | Tools | Target Coverage |
|----------|-------|-------|-----------------|
| **Unit** | Functions, classes, parsers | Vitest | >90% core, >80% providers |
| **Integration** | Core Engine ↔ Providers, MCP tools | Vitest | All 8 tool contracts |
| **Provider** | Rizin/JADX output parsing | Vitest + fixtures | Each capability |
| **E2E** | CLI → Core → Provider → SQLite | Vitest + CLI | Critical paths |
| **Contract** | MCP schema compliance | Custom validator | All 8 tools |
| **Security** | Authorization, boundaries | Custom | All enforcement points |

### 12.3 Test Fixtures

```
tests/fixtures/
├── sample-binaries/
│   ├── hello.elf           # Simple ELF (Linux)
│   ├── hello.exe           # Simple PE (Windows)
│   └── stripped.elf        # Stripped binary
└── sample-apks/
    ├── simple.apk          # Basic APK
    ├── multi-dex.apk       # Multi-DEX
    └── obfuscated.apk      # ProGuard/R8
```

### 12.4 Validation Criteria

| Test | Pass Criteria |
|------|---------------|
| Unit tests | All pass, coverage thresholds met |
| Integration tests | MCP tools return valid schemas, errors handled |
| Provider tests | Each capability produces valid findings with evidence + provenance |
| E2E tests | Full investigation completes, report generated |
| Contract tests | All tool I/O matches JSON schemas |
| Security tests | Unauthorized requests denied, audit log complete |

---

## 13. Development Roadmap

### 13.1 Phase Classification

| Classification | Criteria |
|----------------|----------|
| **Core MVP** | 4 packages, 2 providers, 8 MCP tools, SQLite evidence, auth enforcement, CLI, Windows install |
| **Phase 2** | Web provider (Playwright), .NET provider, network provider, report templates, docs site |
| **Phase 3** | Runtime provider (Frida), correlation engine, plugin SDK, TUI dashboard |
| **Optional** | Cloud sync, hosted MCP, marketplace, AI-assisted analysis |

### 13.2 MVP Timeline (6-8 Weeks Solo)

```
Week 1-2: Foundation
├── Monorepo setup (pnpm, TypeScript, ESLint, Vitest)
├── @sre-studio/shared: types, error classes, 8 MCP JSON schemas
├── @sre-studio/core: SQLite adapter, migrations, repository pattern
├── CI pipeline: lint, typecheck, test, build

Week 3-4: Core Engine
├── SessionManager: CRUD, persistence, progress tracking
├── CapabilityRegistry: register, resolve, validate
├── EvidenceEngine: finding creation, confidence calculation, provenance, persistence
├── AuthorizationManager: boundaries, enforcement middleware, audit log
├── Unit tests for all core modules

Week 5-6: Providers
├── Binary Provider (Rizin): 6 capabilities, parsers, confidence
├── Android Provider (JADX+apktool): 5 capabilities, parsers, confidence
├── Provider integration tests with fixtures
├── Environment validation (doctor command)

Week 7-8: MCP Server & CLI
├── MCP Server: stdio transport, 8 tool handlers, schema validation
├── CLI: all 11 commands, output formatters, agent-config generator
├── E2E tests: full investigation flows via CLI and MCP
├── Windows install scripts (install-providers.ps1, dev-setup.ps1)
├── Documentation: quick-start, installation, MCP config, CLI reference

Week 9: Polish & Release
├── Security audit: auth enforcement, read-only verification
├── Performance: large binary/APK handling
├── Beta release: npm publish @sre-studio/cli, @sre-studio/mcp-server
├── Community feedback iteration
```

### 13.3 Milestone Deliverables

| Milestone | Deliverable | Success Criteria |
|-----------|-------------|------------------|
| M1: Foundation | Working monorepo, shared types, SQLite schema v1 | `pnpm test` passes, migrations run |
| M2: Core Engine | Session, Registry, Evidence, Auth managers | Unit tests >90%, sessions persist |
| M3: Providers | Rizin + JADX providers with 11 capabilities | Fixture APK/binary produce valid findings |
| M4: MCP Server | 8 tools, stdio transport, schema validation | Claude Code connects, tools work |
| M5: CLI | All commands, agent-config, doctor | Full investigation via CLI |
| M6: Integration | E2E tests, Windows install, docs | `sre-studio doctor` passes on clean Windows |
| M7: Beta | v0.1.0 release | Community can analyze real targets |

---

## 14. Risks and Technical Constraints

### 14.1 Technical Risks (MVP)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Rizin JSON output changes** | Medium | Medium | Version pinning; parser tests with fixture outputs; fallback to text parsing |
| **JADX CLI output variability** | Medium | Medium | Test against multiple JADX versions; use `--export-gradle` for structured output |
| **apktool resource parsing edge cases** | Medium | Low | Comprehensive fixture set; graceful degradation |
| **SQLite concurrent access (better-sqlite3)** | Low | High | WAL mode; single-writer pattern; connection pooling in Core |
| **Cross-platform tool paths (Windows)** | High | Medium | `doctor` auto-detection; user config override; install scripts |
| **Large binary analysis performance** | High | Medium | Streaming parsing; progress notifications; resource limits |
| **MCP SDK version drift** | Low | High | Pin SDK version; integration tests against protocol spec |

### 14.2 Platform Constraints (MVP)

| Constraint | Details |
|------------|---------|
| **Node.js** | >=20 LTS (native fetch, test runner, ES modules) |
| **Package Manager** | pnpm 9+ (workspace support, disk efficiency) |
| **TypeScript** | 5.5+ (strict mode, decorators) |
| **OS Support** | Windows (primary), macOS, Linux (WSL2 recommended for Windows) |
| **External Tools** | Must be installed separately: Rizin, JADX, apktool, aapt2, apksigner |
| **Memory** | 4GB+ recommended; 8GB+ for large binaries |
| **Disk** | 2GB+ for provider caches, evidence storage, temp files |
| **Java** | JDK 17+ required for JADX/apksigner |

### 14.3 Legal/Compliance Risks

| Risk | Mitigation |
|------|------------|
| **Reverse engineering legality varies** | Clear documentation; user responsibility; no automated bypass |
| **Tool licenses** | Rizin (LGPL), JADX (Apache 2.0), apktool (Apache 2.0) — compatible |
| **Export control** | Document capabilities; no cryptanalysis automation |
| **Malware analysis safety** | Sandbox defaults; no dynamic execution in MVP; network isolation |

### 14.4 Adoption Risks

| Risk | Mitigation |
|------|------------|
| **Agent ecosystem changes** | MCP standard compliance; generic fallback config |
| **Learning curve** | Comprehensive docs; guided workflows; `doctor` diagnostics |
| **Provider setup complexity** | Install scripts (PS1/SH); Docker image; `doctor` validation |
| **Competition with existing tools** | Differentiation: evidence-first, agent-native, reproducible, clean-room |

---

## Appendix A: Technology Decisions (MVP)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Language** | TypeScript | Type safety, ecosystem, MCP SDK, agent compatibility |
| **Package Manager** | pnpm | Workspace support, disk efficiency, fast installs |
| **Build Tool** | TypeScript Compiler (tsc) + tsup | Simple, standard, fast |
| **Test Runner** | Vitest | Native ESM, fast, TypeScript native |
| **Database** | SQLite (better-sqlite3) | Zero-config, embedded, JSON1, WAL mode |
| **CLI Framework** | Commander.js | Mature, TypeScript support, subcommands |
| **MCP SDK** | @modelcontextprotocol/sdk | Official, maintained, protocol compliant |
| **Process Execution** | Node child_process + spawn | Native, streaming, cross-platform |
| **Logging** | Pino | Fast, structured, child loggers, redaction |
| **Config** | YAML (js-yaml) + JSON Schema | Human-readable, validatable |
| **Template Engine** | Handlebars | Agent config generation |
| **CI/CD** | GitHub Actions | Native, free for public, matrix builds |

---

## Appendix B: Existing Asset Migration Plan

| Current Asset | Migration Strategy |
|---------------|-------------------|
| `README.md` | Keep as project landing page; link to new docs |
| `README_BN.md` | Migrate to `docs/guides/installation-bn.md` |
| `AGENTS.md` | Convert to `docs/guides/agent-operating-guide.md` |
| `CHANGELOG.md` | Continue; add platform versioning from v0.1.0 |
| `CONSOLIDATION_MAP.md` | Archive; replace with `docs/architecture/provider-registry.md` |
| `skill-manifest.json` | Archive; capability registry replaces this |
| `.claude/skills/.../SKILL.md` | Archive; MCP tools replace skill invocation |
| `.claude/skills/.../references/*.md` | Convert to provider capability docs + workflow prompts |
| `.claude/skills/.../templates/*.md` | Convert to report templates in `@sre-studio/cli` |
| `scripts/validate_pack.py` | Replace with `tools/validate-structure.ts` |
| `scripts/new_project.py` | Replace with `sre-studio init` command |
| `assets/banner.png` | Use in docs site and README |

---

## Appendix C: Resolved Open Questions

| Question | Decision |
|----------|----------|
| Monorepo vs. Multi-repo | pnpm monorepo (4 published + internal providers) |
| Binary provider | Rizin only (lighter, no Java, good JSON output) |
| Configuration format | YAML (human-readable, comments, validatable) |
| Evidence storage | SQLite primary, JSONL export for portability |
| MCP transport | stdio only for MVP; transport interface extensible |
| Windows support | Primary target; PS1 install scripts; native paths |
| License | Apache 2.0 (matches Rizin/JADX/apktool) |
| Telemetry | None in MVP; opt-in in Phase 2 |
| Plugin SDK | Internal only for v1; public API in Phase 3 |
| GUI/TUI | Deferred to Phase 3 |

---

## Appendix D: MVP Architecture Diagram (Text)

```
┌────────────────────────────────────────────────────────────────────┐
│                        AGENTS (MCP Clients)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                         │
│  │Claude Code│ │  Cursor  │ │ Codex CLI│                         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                         │
└───────┼─────────────┼─────────────┼───────────────────────────────┘
        │             │             │
        ▼             ▼             ▼
┌────────────────────────────────────────────────────────────────────┐
│                  @sre-studio/mcp-server                            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ stdio transport → JSON-RPC 2.0                               │  │
│  │ 8 Tool Handlers (thin adapters)                              │  │
│  │ • investigation.start/status/close                           │  │
│  │ • target.register/list                                       │  │
│  │ • analysis.run/capabilities                                  │  │
│  │ • evidence.query                                             │  │
│  │ All delegate to Core Engine                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    @sre-studio/core     │
                    │  (Pure TypeScript Lib)  │
                    ├─────────────────────────┤
                    │ SessionManager          │
                    │ CapabilityRegistry      │
                    │ EvidenceEngine          │
                    │ AuthorizationManager    │
                    │ Storage (SQLite + WAL)  │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
       ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
       │  Provider:  │  │  Provider:  │  │  (Future)   │
       │   Binary    │  │  Android    │  │  Providers  │
       │  (Rizin)    │  │ (JADX+apk)  │  │             │
       │             │  │             │  │             │
       │ binary.info │  │android.manif│  │             │
       │ binary.symb │  │android.perms│  │             │
       │ binary.str  │  │android.res  │  │             │
       │ binary.sect │  │android.dex  │  │             │
       │ binary.imp  │  │android.sign │  │             │
       │ binary.cfg  │  │             │  │             │
       └─────────────┘  └─────────────┘  └─────────────┘
              │                 │
              ▼                 ▼
       ┌─────────────────────────────────┐
       │     External Tools (System)     │
       │  rizin, rabin2, rz-pipe         │
       │  jadx, apktool, aapt2,          │
       │  apksigner                      │
       └─────────────────────────────────┘
```

---

**End of Revised Architecture Proposal (MVP)**

**Next Steps (Upon Final Approval):**
1. Initialize pnpm monorepo with TypeScript configuration
2. Create `@sre-studio/shared` with core types, errors, and 8 MCP JSON schemas
3. Build `@sre-studio/core` with SQLite storage, migrations, SessionManager, CapabilityRegistry, EvidenceEngine, AuthorizationManager
4. Implement `@sre-studio/mcp-server` with stdio transport and 8 tool handlers
5. Develop `@sre-studio/cli` with all 11 commands and agent-config generator
6. Build Binary Provider (Rizin) with 6 capabilities
7. Build Android Provider (JADX + apktool) with 5 capabilities
8. Integrate all components, E2E tests, Windows install scripts
9. Documentation: quick-start, installation, MCP config, CLI reference
10. Release v0.1.0-beta

**Awaiting your final implementation approval.**