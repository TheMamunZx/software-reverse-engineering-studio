# Security Model & Resource Limits

SRE Studio is designed for reverse engineering potentially suspicious or unknown software artifacts. Its architecture is built around defense-in-depth, fail-closed authorization, strict target containment, and process-level execution controls.

---

## Core Security Rules

### 1. Static-Only Analysis: Never Execute Target Artifacts
SRE Studio **never executes analyzed binaries, shared libraries, or APK packages**.
All analysis is performed purely via static inspection tools (`rizin`, `rabin2`, `aapt2`, `apksigner`, `jadx`, `apktool`). Target files are treated strictly as read-only data inputs to analysis tools, never as runnable code.

### 2. Fail-Closed Authorization
The platform enforces a fail-closed boundary policy across all entry points (CLI, MCP Server, Orchestrator):
- **Empty Boundaries**: If boundary rules contain no allowed targets or capabilities, all operations are rejected immediately.
- **Explicit Scoping**: Analysis requests must target a file matching an allowed path pattern or type.
- **Hash Verification**: If a target rule specifies a `hashAllowlist`, the target's computed SHA-256 hash must match. Mismatched hashes are denied and logged to SQLite audit trails.
- **Path Traversal Defense**: All target file paths are normalized (`path.normalize`) prior to boundary matching. Traversal sequences like `../../Windows/System32` cannot escape configured target boundaries.

### 3. Safe Subprocess Spawning
When invoking external tools:
- Child processes are **always** spawned with argument arrays and `shell: false`.
- Shell metacharacters (`&`, `|`, `;`, `>`, `$()`) are treated as literal strings and cannot be interpreted by a shell interpreter (`cmd.exe`, `powershell.exe`, `/bin/sh`).
- Timeouts (`timeoutMs`) are strictly enforced; runaway processes are killed immediately with `SIGKILL` / `TerminateProcess`.
- `maxBuffer` limits (default: 10 MB - 50 MB) prevent buffer overflow and memory exhaustion attacks from malicious or oversized targets.

---

## Windows Resource Limits vs. Sandboxing: Important Distinction

> [!WARNING]
> **Advisory Resource Limits vs. Kernel-Enforced Sandboxing**
> SRE Studio implements process-level concurrency caps, memory thresholds, execution timeouts, and buffer caps within the Node.js runtime. These are **advisory resource controls**, not operating-system-level kernel sandboxes.

### Implemented Resource Controls
1. **Concurrency Caps**:
   `AuthorizationManager` tracks active analysis executions (`beginAnalysis()`, `endAnalysis()`). If concurrency exceeds configured limits (e.g. `maxConcurrentAnalyses: 5`), subsequent requests are rejected with a structured `resource-limit` error.
2. **Process Memory Checks**:
   Before initiating an analysis run, the engine queries `process.memoryUsage().rss`. If process memory exceeds `maxMemoryMb`, new analyses are blocked until memory is freed.
3. **Execution Timeouts**:
   Every subprocess spawned by providers enforces a finite timeout (e.g. 30,000 to 120,000 ms).
4. **Buffer Output Limits**:
   Subprocess standard output and error streams enforce `maxBuffer` (e.g. 10 MB) to prevent out-of-memory crashes.

### Limitations of Windows Advisory Controls
On Windows hosts without specialized sandbox drivers or containers:
- SRE Studio does **not** employ Windows Sandbox, AppContainer isolation, or Job Objects for external child tools by default.
- If an external analysis tool (such as an unpatched version of Rizin or JADX) contains a parser vulnerability (e.g. heap corruption when parsing malformed ELF or DEX headers), that vulnerability executes within the security context of the current Windows user.
- **Recommendation for High-Risk Artifacts**: When analyzing untrusted, malicious, or state-sponsored malware, run SRE Studio inside an isolated Windows Sandbox, Hyper-V Virtual Machine, or Docker container with non-root privileges and disabled network adapters.

---

## Audit Logging

Every authorization decision (allow or deny) is recorded immutably in the project's SQLite database in the `audit_log` table:
- Timestamp (ISO 8601)
- Session ID
- Target ID and Path
- Capability ID
- Decision (`allow` or `deny`)
- Reason (e.g. `target-denied`, `capability-denied`, `resource-limit`)
- Approval required status

This audit trail cannot be modified via MCP or CLI commands.

