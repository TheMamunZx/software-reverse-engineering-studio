# Contributing to Software Reverse Engineering Studio

Thank you for your interest in contributing to SRE Studio! We welcome community contributions that advance lawful, ethical software reverse engineering, security analysis, and independent interoperability tools.

---

## Clean-Room Engineering & Legal Conduct

SRE Studio is developed strictly under clean-room engineering standards:
1. **Never commit proprietary code**: Do not commit decompiled proprietary source code, copyrighted firmware, proprietary binaries, or non-public SDK headers.
2. **Authorized test fixtures only**: All test binaries and APKs must be synthetic, open-source, or explicitly licensed for public distribution (e.g., our synthetic C/Rust fixtures in `tests/fixtures/`).
3. **No access control bypass tools**: SRE Studio is an analysis platform, not an exploitation or DRM-cracking toolkit. Submissions intended to circumvent copyright protection systems or licensing locks will be rejected.
4. **Apache-2.0 License**: All contributions are licensed under the Apache License 2.0.

---

## Development Environment Setup

### Prerequisites
- **Node.js**: `>= 20.0.0` (LTS 20 or LTS 22 strongly recommended).
- **pnpm**: `>= 9.0.0` (`npm install -g pnpm`).
- **Git**: For version control.

### Setup Steps
```bash
# Clone repository
git clone https://github.com/TheMamunZx/software-reverse-engineering-studio.git
cd software-reverse-engineering-studio

# Install monorepo dependencies
pnpm install

# Build all packages
pnpm run build

# Run full test suite
pnpm run test

# Run TypeScript typechecks
pnpm run typecheck
```

---

## Monorepo Architecture & Packages

SRE Studio uses pnpm workspaces with strict layering:

| Package | Path | Purpose | Dependencies |
|---------|------|---------|--------------|
| `@sre-studio/shared` | `packages/shared` | Common domain types, errors, logger, and schemas | Zero internal deps |
| `@sre-studio/core` | `packages/core` | Session lifecycle, evidence engine, fail-closed auth, SQLite | `@sre-studio/shared` |
| `@sre-studio/provider-binary` | `packages/providers/binary` | Static binary analysis (Rizin, rabin2) | `@sre-studio/shared`, `@sre-studio/core` |
| `@sre-studio/provider-android` | `packages/providers/android` | Static Android APK analysis (aapt2, JADX, apktool) | `@sre-studio/shared`, `@sre-studio/core` |
| `@sre-studio/mcp-server` | `packages/mcp-server` | Model Context Protocol stdio JSON-RPC server | `@sre-studio/shared`, `@sre-studio/core` |
| `@sre-studio/cli` | `packages/cli` | Interactive command-line interface (`sre-studio`) | All above packages |

### Architectural Rules
- `packages/shared` must never depend on any other package.
- `packages/core` must never depend on `mcp-server` or `cli`.
- Providers must implement the `AnalysisProvider` interface from `@sre-studio/core`.
- Security boundaries in `@sre-studio/core` must remain **fail-closed**.

---

## Verification & Testing Requirements

Every Pull Request must satisfy all of the following checks before merging:

### 1. Unit & Integration Tests
```bash
pnpm run test
```
All existing tests (~306+ tests across 31 test files) must pass. New capabilities must include corresponding Vitest test files.

### 2. TypeScript Typechecking
```bash
pnpm run typecheck
```
Must pass with zero errors across all 6 packages.

### 3. Packaging & Clean Installation Audit
```bash
pnpm run pack:audit
```
This script packs all packages into temporary tarballs, validates that no `src/`, `test/`, `node_modules`, or secret files are leaked, and performs a clean installation and binary smoke test in an isolated temporary directory.

### 4. Benchmark Verification
```bash
pnpm run benchmark
```
Ensures report generation and evidence querying performance remain within target latency budgets.

---

## Pull Request Guidelines

1. **Branching**: Create a feature branch from `main` (e.g. `git checkout -b feature/elf-relocations`).
2. **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat(provider-binary): add relocation entry extraction`, `fix(core): reject junction boundary escapes`).
3. **Documentation**: Update relevant documentation in `docs/` and `README.md` if changing user-facing commands, MCP tools, or configuration options.
4. **Honest Testing**: In PR descriptions, report actual test outputs honestly. Clearly differentiate fixture-based tests from live external tool integration tests.

