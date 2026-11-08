# Changelog

All notable changes to the Software Reverse Engineering Studio (`sre-studio`) platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0-beta.1] - 2026-11-08

### Release Classification: Beta
This initial public release of Software Reverse Engineering Studio is classified as **Beta (`v0.1.0-beta.1`)**.
- **Verified on Host**: Complete TypeScript monorepo platform, fail-closed authorization, normalized SQLite persistence, CLI, MCP stdio server, 4 report formats, benchmark harness, packaging hygiene, and live Android asset analysis (`aapt2`).
- **Unverified External Providers**: External disassembly and decompilation tools (`rizin`, `jadx`, `apktool`) are fully implemented and wrapped with safe subprocess controls, but were unverified on this host due to missing third-party binary installations.
- **Advisory Sandboxing**: Windows process controls (concurrency caps, memory thresholds, execution timeouts, output buffer caps) are advisory application-level guards, not OS-level kernel sandboxes.

---

### Milestone 7: Documentation, Packaging & Release Readiness
- **Packaging Validation**: Added automated tarball packing audit script (`scripts/pack-audit.mjs` / `pnpm run pack:audit`) that packs all 6 packages, inspects tarballs for hygiene (confirming zero leakage of `src/`, `test/`, `node_modules`, or `.env`), and tests installation and binary execution in an isolated temporary directory.
- **Package Manifests**: Standardized metadata across all 6 workspace packages (`license: "Apache-2.0"`, `engines: { "node": ">=20.0.0" }`, `files: ["dist"]`, repository, and issue tracker links).
- **CI/CD Automation**: Created GitHub Actions workflows for continuous integration (`.github/workflows/ci.yml` testing Windows and Ubuntu across Node 20 and 22 LTS), package hygiene validation (`.github/workflows/package-validation.yml`), and draft release asset generation (`.github/workflows/release.yml`).
- **Comprehensive Documentation**:
  - `docs/guides/investigation-workflow.md`: Complete end-to-end guide detailing project scoping, target ingestion, static capability execution, evidence scoring, report generation, and clean-room independent implementation methodology.
  - `CONTRIBUTING.md` & `docs/guides/contributing.md`: Clean-room development guidelines, PR submission standards, and verification criteria.
  - Updated `README.md`, `docs/architecture/overview.md`, `docs/guides/installation.md`, `docs/guides/cli-reference.md`, `docs/guides/mcp-configuration.md`, `docs/guides/provider-setup.md`, `docs/guides/security.md`, and `docs/guides/troubleshooting.md`.

---

### Milestone 6: Integration, Security Hardening & Benchmarking
- **Symlink & Directory Junction Security**: Hardened `AuthorizationManager` with `fs.realpathSync` path resolution to detect and reject targets escaping authorized boundaries via Windows directory junctions or Unix symlinks.
- **Subprocess Execution Safety**: Enforced argument arrays with `shell: false`, strict execution timeouts, output buffer caps, and concurrency limits across all child processes.
- **Performance Benchmarks**: Added benchmark harness (`scripts/benchmark.mjs`) demonstrating high-volume report generation (1,000 findings across Markdown, HTML, JSON, and SARIF).
- **Live Tool Verification**: Verified live invocation of `aapt2` on host Windows environment.
- **Test Baseline**: Expanded automated test suite to 306 passing tests across 31 test files with 100% test pass rate.

---

### Milestone 5: Interactive CLI & Multi-Format Reporting
- **Command-Line Interface**: Implemented `sre-studio` CLI supporting `init`, `status`, `target`, `capabilities`, `analyze`, `evidence`, `report`, `doctor`, `provider`, and `close`.
- **Multi-Format Reports**:
  - Markdown: Comprehensive technical investigation reports with metadata and tables.
  - HTML: Standalone responsive HTML reports with CSS styling.
  - JSON: Complete structured finding exports.
  - SARIF: OASIS Static Analysis Results Format v2.1.0 for IDE and security scanner integration.
- **Environment Diagnostics**: Implemented `sre-studio doctor` for verifying Node.js runtime, SQLite connectivity, and external tool binaries.

---

### Milestone 4: MCP stdio Server & AI Agent Integrations
- **MCP Server**: Implemented Model Context Protocol (MCP) server over standard I/O streams using `@modelcontextprotocol/sdk`.
- **8 Core MCP Tools**: `investigation.start`, `investigation.status`, `investigation.close`, `target.register`, `target.list`, `analysis.run`, `analysis.capabilities`, and `evidence.query`.
- **Agent Configurations**: Provided validated configuration templates for Claude Code (`.claude/mcp.json`), Cursor (`.cursor/mcp.json`), and native Codex CLI TOML (`~/.codex/config.toml`).
- **Protocol Tests**: Added full JSON-RPC stdio integration tests verifying initialization, tool discovery, execution, authorization denials, and graceful shutdown.

---

### Milestone 3: Static Analysis Providers (Binary & Android)
- **Binary Provider (`@sre-studio/provider-binary`)**: Implemented safe wrappers for Rizin and `rabin2` providing `binary.info`, `binary.sections`, `binary.imports`, `binary.exports`, `binary.strings`, and `binary.disasm`.
- **Android Provider (`@sre-studio/provider-android`)**: Implemented safe wrappers for `aapt2`, `apksigner`, `jadx`, and `apktool` providing `android.manifest`, `android.permissions`, `android.signatures`, `android.decompile`, and `android.smali`.
- **Pure JS/TS Fallback Parsers**: Added direct header and section parsers for ELF, PE, and DEX file formats.
- **Benign Test Fixtures**: Added synthetic, authorized C/Rust PE/ELF test binaries and minimal Android APK fixtures.

---

### Milestone 2: Core Domain, Fail-Closed Security & SQLite Persistence
- **Investigation Orchestrator & Sessions**: Implemented project lifecycle management, session tracking, and target registration.
- **Normalized SQLite Storage**: Implemented `better-sqlite3` storage adapter with foreign-key enforcement and WAL mode (`sessions`, `targets`, `environments`, `findings`, `evidence`, `audit_log`).
- **Fail-Closed Authorization**: Enforced boundary rules rejecting empty boundaries, directory traversal attempts, and unlisted file hashes.
- **Multi-Factor Confidence Scoring**: Normalized confidence calculation combining heuristic weight, tool reliability, cross-validation, and operator review.

---

### Milestone 1: Monorepo Foundation & Clean-Room Architecture
- **Monorepo Structure**: Set up pnpm workspace with TypeScript 5.5, Vitest, and tsup bundler.
- **Shared Package (`@sre-studio/shared`)**: Defined domain types, custom error classes, Pino logger factory, and JSON Schema draft 2020-12 validation utilities.
- **Clean-Room Guidelines**: Established repository licensing (Apache-2.0) and ethical reverse engineering boundaries.
