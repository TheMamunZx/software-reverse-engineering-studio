![Software Reverse Engineering Studio](./assets/software-reverse-engineering-studio-banner.png)

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/TheMamunZx/software-reverse-engineering-studio)
[![Release](https://img.shields.io/badge/Release-v0.1.0--beta.1-blue.svg)](https://github.com/TheMamunZx/software-reverse-engineering-studio/releases)
[![License](https://img.shields.io/badge/License-Apache_2.0-green.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude-Code-5A67D8)](https://claude.ai/code)
[![OpenCode](https://img.shields.io/badge/Open-Code-00A67E)](https://opencode.dev)

**Analyze authorized software behavior · Document observable patterns · Build independent implementations**

[Overview](#about-software-reverse-engineering-studio) · [Status & Capabilities](#release-status--capability-matrix) · [Quick Start](#quick-start-cli--mcp) · [Workflow](docs/guides/investigation-workflow.md) · [Architecture](docs/architecture/overview.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

</div>

---

## Release Status & Capability Matrix

> [!NOTE]
> **Release Classification: Beta (`v0.1.0-beta.1`)**
> SRE Studio is currently in public Beta. The core orchestration, normalized SQLite persistence, fail-closed authorization, interactive CLI, MCP stdio server, and multi-format reporting are fully implemented and verified with 306+ automated tests. Third-party disassembly/decompilation backends (`rizin`, `jadx`, `apktool`) require external user-installed binaries; `aapt2` is verified live on Windows.

| Capability Area | Status | Description |
|-----------------|--------|-------------|
| **Core Orchestrator & Sessions** | **Implemented** | Session lifecycle, targets, environments, evidence graph, SQLite WAL persistence with foreign keys |
| **Fail-Closed Security** | **Implemented** | Strict boundary policies, empty-boundary rejection, path traversal defense, symlink/junction resolution (`fs.realpathSync`), target SHA-256 allowlists |
| **Model Context Protocol (MCP)** | **Implemented** | stdio JSON-RPC server with 8 versioned tools, Draft 2020-12 JSON Schema validation |
| **CLI (`sre-studio`)** | **Implemented** | Interactive commands: `init`, `status`, `target`, `capabilities`, `analyze`, `evidence`, `report`, `doctor`, `provider`, `close` |
| **Multi-Format Reporting** | **Implemented** | Markdown, HTML, JSON, and OASIS SARIF v2.1.0 reports verified against 1,000 findings |
| **Subprocess Execution Safety** | **Implemented** | Argument arrays with `shell: false`, timeouts, buffer caps, concurrency limits, memory checks |
| **Packaging & Distribution** | **Implemented** | Clean pnpm workspaces, 0 leaked files, tarball audit script (`pnpm run pack:audit`) |
| **Android Asset Analysis (`aapt2`)** | **Implemented & Verified Live** | Static manifest, resources, package details via live Windows `aapt2.exe` |
| **Native Binary Fallback** | **Implemented** | In-tree pure JS/TS parsers for ELF, PE, and DEX headers/sections/strings |
| **Binary Disassembly (`rizin` / `rabin2`)** | **External-Tool Dependent** | Code complete with safe subprocess execution; requires external Rizin installation |
| **Android Decompilation (`jadx` / `apktool`)**| **External-Tool Dependent** | Code complete with safe subprocess execution; requires external JADX / Apktool installation |
| **OS-Level Kernel Sandboxing** | **Planned (Future)** | Windows Job Object isolation, Linux cgroups/namespaces (current controls are advisory) |
| **Web UI / Electron Desktop** | **Planned (Future)** | Standalone desktop/browser interactive reverse engineering interface |
| **Ghidra / IDA Pro Integration** | **Planned (Future)** | Headless decompilation backends for Ghidra and IDA Pro |

---

## About Software Reverse Engineering Studio

Coordinate end-to-end software reverse engineering workflows through one discoverable master skill and an agent-native reverse engineering platform. Analyze software you own or are authorized to inspect, document observable behavior, and create lawful independent implementations without copying protected source code or bypassing access controls.

This repository provides both an agent skill pack and a complete TypeScript monorepo platform featuring a Model Context Protocol (MCP) server, interactive CLI, Core investigation engine with fail-closed authorization, SQLite persistence, and pluggable static analysis providers.

## Architecture & Monorepo Packages

SRE Studio is structured as a clean-room monorepo managed with pnpm workspaces:

```
software-reverse-engineering-studio/
├── packages/
│   ├── shared/             # Domain types, errors, logger, and JSON schemas (Draft 2020-12)
│   ├── core/               # Investigation engine, sessions, evidence, SQLite, and fail-closed auth
│   ├── mcp-server/         # MCP stdio server with 8 versioned tools
│   ├── cli/                # Interactive command line interface (sre-studio)
│   └── providers/
│       ├── binary/         # Static binary provider (Rizin, rabin2)
│       └── android/        # Static Android provider (aapt2, apksigner, JADX, apktool)
├── docs/                   # Complete architectural, setup, security, and reference guides
│   ├── architecture/       # System architecture and data flow diagrams
│   └── guides/             # Quick start, MCP configuration, CLI reference, and security
├── tests/fixtures/         # Authorized, benign test fixtures (sample.exe, sample.elf, sample.apk)
└── scripts/                # Setup, fixture generation, benchmarking, and provider diagnostics
```

### Complete Documentation

- [Architecture Overview](docs/architecture/overview.md)
- [Installation & Windows Setup Guide](docs/guides/installation.md)
- [Quick Start Guide](docs/guides/quick-start.md)
- [Investigation & Evidence Workflow Guide](docs/guides/investigation-workflow.md)
- [MCP Client Integration (Claude Code, Cursor, Codex CLI)](docs/guides/mcp-configuration.md)
- [CLI Reference](docs/guides/cli-reference.md)
- [Provider Setup & Tool Verification](docs/guides/provider-setup.md)
- [Security Model & Resource Limits](docs/guides/security.md)
- [Troubleshooting & FAQ](docs/guides/troubleshooting.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Changelog & Release Notes](CHANGELOG.md)

## Quick Start (CLI & MCP)

### 1. Build and Test Monorepo
```bash
# Windows automated setup
.\scripts\dev-setup.ps1

# Or manual build & test
pnpm install
pnpm run build
pnpm run test
```

### 2. Run Interactive CLI
```bash
# Initialize investigation project
sre-studio init my-investigation --name "PE Sample Analysis" --scope "Authorized testing" --auth-type owner
cd my-investigation

# Register target
sre-studio target add ../tests/fixtures/sample-binaries/sample.exe --type binary

# Check status and run analysis
sre-studio status
sre-studio analyze binary.info

# Query findings and export report
sre-studio evidence summary
sre-studio report --format markdown --output report.md
```

### 3. Connect MCP to AI Assistants

Start the MCP server over standard I/O:
```bash
node packages/mcp-server/dist/server.js
```

Configure your assistant:
- **Claude Code**: Add `sre-studio` via `claude mcp add sre-studio -- node path/to/server.js` (or `.claude/mcp.json`).
- **Cursor**: Configure `mcpServers.sre-studio` in `.cursor/mcp.json`.
- **Codex CLI**: Append `[mcp_servers.sre-studio]` to `~/.codex/config.toml` (see [Codex TOML Guide](docs/guides/mcp-configuration.md#3-codex-cli-native-configuration)).

---

## Project Overview and Statistics

| Metric | Value |
|--------|-------|
| **Master Skills** | 1 |
| **Internal Modules** | 8 |
| **Human-Centered Design Modules** | 3 |
| **Supported Platforms** | Claude Code, OpenCode |
| **Analysis Types** | Web, APK, Binary, API, Software |

## What Can You Analyze?

### Observable Targets

- **Websites and Web Applications** — DOM structure, responsive layouts, component behavior, navigation flows, public assets
- **Android APKs** — manifest inspection, resource extraction, static structure analysis, declared permissions
- **Binary Files** — format inspection, static analysis, symbol extraction, basic disassembly
- **API Traffic** — authorized endpoint behavior, request/response patterns, data contracts, error handling
- **Software Architecture** — technology stack identification, component mapping, interaction patterns

### Limitations

- Cannot recover private source code from compiled artifacts or deployed websites
- Cannot bypass authentication, paywalls, DRM, or access controls
- Cannot extract proprietary algorithms or trade secrets
- Cannot analyze systems without proper authorization
- Cannot guarantee complete behavior coverage from external observation alone

## Master Skill Architecture

This repository exposes **one discoverable skill**:

```
software-reverse-engineering-studio
```

Invoke this master skill. It coordinates appropriate internal specialist modules automatically based on your analysis target and requirements.

### Internal Specialist Modules

| Module | Role | Loaded When |
|--------|------|-------------|
| `software-reverse-engineer` | General software analysis and implementation planning | Any reverse engineering task |
| `web-app-analyzer` | Website and web application structure analysis | Analyzing web-based targets |
| `apk-analysis-engineer` | Android APK inspection and component extraction | Analyzing APK files |
| `binary-analysis-engineer` | Binary file inspection and static analysis | Analyzing compiled binaries |
| `api-traffic-analyzer` | API endpoint behavior and contract documentation | Analyzing network traffic |
| `human-centered-product-design` | User-centered interface design principles | Building user-facing implementations |
| `design-quality-critic` | Design review and quality assessment | Reviewing implementation quality |
| `product-experience-engineer` | Professional product experience refinement | Polishing final deliverables |

**You do not select individual modules manually.** The master skill loads relevant references as needed.

## Reverse Engineering Workflow

```mermaid
graph LR
    A[Authorized Target] --> B[Reconnaissance]
    B --> C[Structure Analysis]
    C --> D[Behavior Mapping]
    D --> E[Component Extraction]
    E --> F[Architecture Planning]
    F --> G[Independent Implementation]
    G --> H[Visual Comparison]
    H --> I[Functional Testing]
    I --> J[Quality Review]
    J --> K[Final Deliverable]
```

### Workflow Phases

1. **Authorization Confirmation** — Verify ownership or permission to analyze target
2. **Reconnaissance** — Inventory accessible assets, screens, metadata, runtime conditions
3. **Structure Analysis** — Document DOM, components, navigation, file structure
4. **Behavior Mapping** — Observe interactions, state changes, data flows, API contracts
5. **Component Extraction** — Identify reusable patterns, layouts, styles, logic
6. **Architecture Planning** — Design independent implementation structure
7. **Independent Implementation** — Build original code using extracted knowledge
8. **Visual Comparison** — Validate layout, styling, responsive behavior against reference
9. **Functional Testing** — Verify feature parity within observed scope
10. **Quality Review** — Apply design critique and accessibility standards
11. **Final Deliverable** — Package code, documentation, evidence, and test results

## Website Analysis

### Capabilities

- Inspect publicly accessible pages and DOM structure
- Extract layout patterns, component hierarchy, responsive breakpoints
- Document navigation flows and user interaction patterns
- Identify CSS frameworks, JavaScript libraries, technology stack
- Analyze color schemes, typography, spacing systems
- Map routing structure and page relationships

### Deliverables

- Component and layout documentation
- CSS and design system extraction
- Navigation and routing maps
- Technology stack report
- Independent implementation codebase
- Visual parity validation report

## Web Application Analysis

### Capabilities

- Analyze authorized web application structure and behavior
- Document form interactions, validation patterns, error handling
- Map state management and data flow patterns
- Observe API endpoint usage and response contracts
- Identify authentication flows and protected routes
- Extract business logic patterns from observable behavior

### Deliverables

- Application architecture diagram
- API endpoint documentation
- State management specification
- Form and validation logic
- Error handling patterns
- Independent implementation with functional parity

## Android APK Analysis

### Capabilities

- Extract and inspect AndroidManifest.xml
- List declared permissions, activities, services, receivers
- Extract resources (layouts, strings, drawables)
- Analyze APK structure and component organization
- Document declared features and configurations
- Basic static analysis of DEX structure

### Limitations

- Cannot fully decompile obfuscated code to original source
- Cannot recover proprietary algorithms or business logic
- Cannot bypass code protection or DRM
- Cannot guarantee complete behavior reconstruction
- Extracted resources are for analysis, not unauthorized redistribution

### Deliverables

- Manifest analysis report
- Permission and feature documentation
- Resource inventory
- Component structure map
- UI layout documentation
- Independent implementation plan

## Binary and Software Analysis

### Capabilities

- Identify file format and executable type
- Extract symbols, imports, exports
- Basic disassembly and static inspection
- Dependency and library identification
- Entry point and section analysis

### Limitations

- Limited by obfuscation, packing, anti-analysis techniques
- Cannot recover original source code
- Cannot bypass software protection mechanisms
- Static analysis only—no dynamic execution tracing

### Deliverables

- Binary structure report
- Symbol and import tables
- Identified dependencies
- Architecture and calling convention documentation

## API and Network Traffic Analysis

### Capabilities

- Document authorized API endpoint behavior
- Extract request/response schemas
- Identify authentication and authorization patterns
- Map error codes and edge case handling
- Document rate limiting and pagination
- Observe data validation rules

### Requirements

- Must have authorization to access and analyze the API
- Cannot bypass authentication or access controls
- Cannot test beyond authorized scope
- Cannot extract private credentials or tokens

### Deliverables

- API endpoint documentation
- Request/response schema specifications
- Authentication flow documentation
- Error handling and validation rules
- Independent API client implementation

## Independent Implementation Workflow

### Design Principles

1. **Original Code** — Write new implementation, do not copy proprietary source
2. **Evidence-Based** — Base decisions on observable behavior, not assumptions
3. **Clean Architecture** — Use modern patterns and best practices
4. **Documented Assumptions** — Track confidence levels and unverified behavior
5. **Test Coverage** — Verify functional parity through automated tests
6. **Legal Compliance** — Respect intellectual property and access controls

### Implementation Process

- Translate behavioral observations into technical specifications
- Select appropriate technology stack and frameworks
- Design component architecture and data models
- Implement core functionality with clean, maintainable code
- Apply responsive design and accessibility standards
- Write tests covering observed behavior
- Document assumptions, limitations, and unverified features

## Human-Centered Product Design

Professional implementations apply **human-centered design principles** throughout development:

- **User-Centered Design** — Focus on user needs, goals, and context
- **Accessibility** — WCAG compliance, keyboard navigation, screen reader support
- **Visual Consistency** — Cohesive design system, typography, spacing
- **Professional Polish** — Attention to detail, smooth interactions, error states
- **Distinctive Character** — Avoid generic AI-generated layouts

### Design Quality Review

The `design-quality-critic` module reviews:

- Visual hierarchy and information architecture
- Color contrast and typography choices
- Layout consistency and responsive behavior
- Interaction patterns and micro-interactions
- Error messaging and edge case handling
- Accessibility and keyboard navigation

### Product Experience Engineering

The `product-experience-engineer` module refines:

- Loading states and perceived performance
- Transitions and animation timing
- Form design and validation feedback
- Empty states and onboarding flows
- Error recovery and help systems

## Quick Start

### Project-Local Installation

Copy the master skill into your target project:

```bash
cp -r .claude/skills/software-reverse-engineering-studio /path/to/target/project/.claude/skills/
```

### Invoke Master Skill

#### Claude Code

```bash
/software-reverse-engineering-studio
```

#### OpenCode

```bash
@software-reverse-engineering-studio
```

Agent discovery behavior varies by version and configuration. Verify the skill appears in available skills before use.

## Claude Code Installation

### Prerequisites

- Claude Code CLI or Desktop App
- Git (for cloning repository)
- Target project with `.claude/skills/` directory

### Installation Steps

1. Clone this repository:

```bash
git clone https://github.com/TheMamunZx/software-reverse-engineering-studio.git
```

2. Copy skill to target project:

```bash
cp -r software-reverse-engineering-studio/.claude/skills/software-reverse-engineering-studio \
  /path/to/your/project/.claude/skills/
```

3. Verify installation:

```bash
cd /path/to/your/project
# Skill should appear in available skills list
```

4. Invoke the skill:

```bash
/software-reverse-engineering-studio
```

## OpenCode Installation

### Prerequisites

- OpenCode CLI or compatible agent
- Git (for cloning repository)

### Installation Steps

1. Clone this repository:

```bash
git clone https://github.com/TheMamunZx/software-reverse-engineering-studio.git
```

2. Copy skill to target project:

```bash
cp -r software-reverse-engineering-studio/.claude/skills/software-reverse-engineering-studio \
  /path/to/your/project/.claude/skills/
```

3. Invoke the skill:

```bash
@software-reverse-engineering-studio
```

### Global Installation (Optional)

Some agent configurations support global skill directories. Consult your agent's documentation for global skill installation procedures.

## Agent Integration (MCP Server)

SRE Studio provides a Model Context Protocol (MCP) server (`sre-studio-mcp`) that exposes reverse engineering tools directly to AI coding agents over stdio.

Configuration files and templates are maintained in [`agent-configs/`](./agent-configs).

### OpenAI Codex CLI

Codex CLI uses TOML configuration (`~/.codex/config.toml` or project-scoped `.codex/config.toml`), declaring servers under `[mcp_servers.<name>]`.

> [!WARNING]
> **Preserve Existing Configuration**: Never overwrite your entire `config.toml` file. Doing so would erase your existing model configurations, aliases, and other registered MCP servers. Always append the new table or use the `codex mcp add` CLI command.

#### Option 1: Automatic Registration via CLI (Recommended)
```bash
codex mcp add sre-studio \
  --env SRE_STUDIO_WORKSPACE=. \
  --env SRE_STUDIO_CONFIG=./.sre-studio/config.yaml \
  -- sre-studio-mcp
```

#### Option 2: Safe Manual TOML Append
Append the following table to your `~/.codex/config.toml` (global) or `.codex/config.toml` (project scope):
```toml
[mcp_servers.sre-studio]
command = "sre-studio-mcp"
args = []
cwd = "."

[mcp_servers.sre-studio.env]
SRE_STUDIO_WORKSPACE = "."
SRE_STUDIO_CONFIG = "./.sre-studio/config.yaml"
```

Verify with `codex mcp list` or `/mcp` inside an active Codex session.

### Claude Code

Add the server definition to `.mcp.json` or `~/.claude.json`:
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

### Cursor IDE

Add the server definition to `.cursor/mcp.json` or `~/.cursor/mcp.json`:
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

> [!NOTE]
> **Validation vs. Live Client Testing**: Configuration files and formats are validated for syntax correctness, required fields, and cross-agent consistency. Live client compatibility testing requires the respective agent client installed in the local environment.

## Supported Tools and Technologies

### Analysis Tools

- Browser DevTools (DOM inspection, network monitoring)
- `apktool` (APK decompilation and resource extraction)
- `jadx` (DEX to Java decompilation)
- Binary analysis tools (`file`, `strings`, `objdump`, `readelf`)
- Network proxies (authorized traffic inspection)

### Implementation Technologies

- **Web Frontend** — React, Vue, Svelte, vanilla JavaScript, HTML5, CSS3
- **Web Backend** — Node.js, Python, Go, Java, PHP
- **Mobile** — React Native, Flutter, native Android/Kotlin
- **APIs** — REST, GraphQL, WebSocket
- **Databases** — PostgreSQL, MongoDB, SQLite, Redis

Tool and framework selection adapts to target technology and project requirements.

## Security and Authorization Requirements

### Critical Requirements

⚠️ **Work only on systems and applications you own or are explicitly authorized to analyze.**

- **No Unauthorized Access** — Do not bypass authentication, paywalls, or access controls
- **No Credential Extraction** — Do not extract or store private tokens, passwords, API keys
- **No Protected Content** — Do not reproduce proprietary source code without permission
- **No Malicious Intent** — Reverse engineering must serve lawful, authorized purposes
- **Treat APKs as Untrusted** — Handle decompiled code and extracted resources safely

### Authorization Checklist

Before beginning analysis:

- [ ] Confirm ownership or explicit written permission
- [ ] Understand permitted scope and prohibited actions
- [ ] Document authorization evidence
- [ ] Respect intellectual property boundaries
- [ ] Follow responsible disclosure for security findings

### Ethical Guidelines

- Distinguish observable behavior from inferred implementation
- Document confidence levels and assumptions
- Respect licenses, copyrights, and trademarks
- Do not redistribute protected assets without permission
- Report security vulnerabilities responsibly

## Testing and Quality Assurance

### Validation Approach

- **Static Validation** — Run `python scripts/validate_pack.py` to check skill structure
- **Functional Testing** — Verify implementation behavior against observed reference
- **Visual Testing** — Compare layouts, responsive behavior, styling
- **Accessibility Testing** — Keyboard navigation, screen reader, WCAG compliance
- **Performance Testing** — Load times, rendering performance, API response times

### Quality Gates

- Implementation builds and runs without errors
- Tests cover critical user flows
- Visual parity achieved within design tolerance
- Accessibility standards met
- Documentation matches delivered implementation
- Security and privacy requirements satisfied

### Limitations

Static validation checks structure only. Does not verify provider availability, API quotas, or runtime behavior in production environments.

## Output Structure and Deliverables

### Standard Deliverables

```
project-name/
├── analysis/
│   ├── reconnaissance-report.md
│   ├── structure-analysis.md
│   ├── behavior-specification.md
│   ├── component-inventory.md
│   └── evidence-log.md
├── architecture/
│   ├── system-design.md
│   ├── data-model.md
│   ├── api-contracts.md
│   └── technology-decisions.md
├── implementation/
│   ├── src/
│   ├── tests/
│   ├── docs/
│   └── README.md
├── validation/
│   ├── parity-test-results.md
│   ├── visual-comparison.md
│   └── accessibility-audit.md
└── final-report.md
```

### Report Contents

- Executive summary and project scope
- Authorization documentation
- Methodology and tools used
- Observable behavior findings
- Architecture and design decisions
- Implementation details and code organization
- Test coverage and validation results
- Known limitations and assumptions
- Recommendations for future work

## Troubleshooting and FAQ

### Common Issues

**Q: Skill not appearing in available skills list**

A: Verify `.claude/skills/software-reverse-engineering-studio/SKILL.md` exists and contains valid frontmatter. Check agent configuration and skill discovery settings.

**Q: Analysis incomplete or missing details**

A: Reverse engineering from external observation has inherent limitations. Private logic, backend implementation, and protected code cannot be fully recovered. Document assumptions and confidence levels.

**Q: APK decompilation fails or produces unreadable code**

A: Obfuscation, code protection, and native libraries limit decompilation effectiveness. Focus on manifest, resources, and observable behavior rather than complete source recovery.

**Q: Visual parity not achieved**

A: Exact pixel-perfect reproduction may not be possible or legally appropriate. Aim for functional and visual equivalence within documented tolerances.

**Q: Authorization unclear**

A: Stop work and clarify authorization before proceeding. Document written permission and permitted scope.

### Validation Errors

Run the validation script to check skill integrity:

```bash
python scripts/validate_pack.py
```

Fix reported issues:
- Missing reference files
- Invalid frontmatter
- Broken internal links
- Accidental secrets in files

### Getting Help

- Review [AGENTS.md](./AGENTS.md) for agent operating guidelines
- Check skill frontmatter and internal references
- Verify tool and dependency availability
- Consult agent documentation for platform-specific issues

## Documentation and Resources

### Repository Structure

```
software-reverse-engineering-studio/
├── .claude/skills/software-reverse-engineering-studio/
│   ├── SKILL.md                              # Master skill entry point
│   ├── references/
│   │   ├── INDEX.md                          # Reference inventory
│   │   ├── software-reverse-engineer.md      # General RE specialist
│   │   ├── web-app-analyzer.md              # Web analysis specialist
│   │   ├── apk-analysis-engineer.md         # APK specialist
│   │   ├── binary-analysis-engineer.md      # Binary specialist
│   │   ├── api-traffic-analyzer.md          # API specialist
│   │   ├── human-centered-product-design.md # Design principles
│   │   ├── design-quality-critic.md         # Design review
│   │   └── product-experience-engineer.md   # UX refinement
│   ├── scripts/                              # Helper scripts
│   ├── templates/                            # Output templates
│   └── assets/                               # Skill assets
├── assets/
│   └── software-reverse-engineering-studio-banner.png
├── scripts/
│   └── validate_pack.py                      # Skill validation
├── README.md                                 # This file
├── README_BN.md                              # Bengali documentation
├── AGENTS.md                                 # Agent operating guide
├── CHANGELOG.md                              # Version history
├── CONSOLIDATION_MAP.md                      # Module organization
└── skill-manifest.json                       # Module inventory
```

### Key Files

- **[SKILL.md](./.claude/skills/software-reverse-engineering-studio/SKILL.md)** — Master skill coordination logic
- **[AGENTS.md](./AGENTS.md)** — Operating guidelines for agent execution
- **[skill-manifest.json](./skill-manifest.json)** — Module inventory and metadata
- **[validate_pack.py](./scripts/validate_pack.py)** — Skill structure validation

### Legal and Compliance

This repository contains agent instructions and reference playbooks only. It is not legal advice, security certification, or authorization to access systems. Users are responsible for:

- Obtaining proper authorization before analysis
- Complying with applicable laws and regulations
- Respecting intellectual property rights
- Following responsible disclosure practices
- Ensuring ethical use of reverse engineering capabilities

### Service Requirements

Actual capabilities depend on:

- Compatible AI agent (Claude Code, OpenCode, or equivalent)
- Tool availability (`apktool`, `jadx`, browser DevTools, etc.)
- API access and quotas
- Runtime environment and dependencies
- Proper credentials and permissions

This repository does not include models, API subscriptions, cloud runtimes, or third-party services.

---

<div align="center">

**Built for authorized software analysis and independent implementation**

[Report Issues](https://github.com/TheMamunZx/software-reverse-engineering-studio/issues) · [Contribute](https://github.com/TheMamunZx/software-reverse-engineering-studio/pulls)

</div>
