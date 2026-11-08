# CLI Command Reference

The SRE Studio Command Line Interface (`sre-studio`) provides complete interactive control over investigations, targets, evidence, providers, and reporting.

## Global Options

- `--verbose`: Enable verbose debug logging to stderr.
- `-V, --version`: Output the current version of SRE Studio.
- `-h, --help`: Display help for any command.

---

## Commands

### `sre-studio init [directory]`
Initializes a new reverse engineering investigation project.
- `--name <name>`: Project name (default: directory name).
- `--primary-target <path>`: Path to initial target file.
- `--primary-type <type>`: Target type (`binary` or `android`).
- `--scope <scope>`: Description of authorized analysis scope.
- `--auth-type <type>`: Authorization type (`owner`, `explicit-permission`, `public`, `authorized-testing`).
- `--force`: Overwrite existing configuration in target directory.

### `sre-studio status`
Displays the current status of the active investigation, registered targets, and finding counts.

### `sre-studio target`
Manage investigation targets.
- `sre-studio target add <path> --type <binary|android> [--role <primary|secondary|reference>]`: Register a target file.
- `sre-studio target list`: List all targets registered in the active session.
- `sre-studio target remove <targetId>`: Remove a registered target.

### `sre-studio capabilities`
Lists all available static analysis capabilities across registered providers.

### `sre-studio analyze <capabilityId>`
Executes an analysis pass against a registered target.
- `--target <targetId>`: Target ID (defaults to primary target).
- `--param <key=value>`: Additional capability parameters.

### `sre-studio evidence`
Inspect and query evidence stored in SQLite.
- `sre-studio evidence list`: List findings with optional filters (`--category`, `--severity`, `--confidence`).
- `sre-studio evidence get <findingId>`: Display detailed JSON evidence for a specific finding.
- `sre-studio evidence summary`: Display breakdown by severity, category, and average confidence.

### `sre-studio report`
Generates an investigation report.
- `--format <markdown|html|sarif|json>`: Output format (default: `markdown`).
- `--template <technical|executive|compliance>`: Report template.
- `--output <filePath>`: Write report to file instead of stdout.
- `--include-evidence`: Include raw evidence payloads.
- `--confidence-threshold <float>`: Minimum confidence score filter (0.0 to 1.0).

### `sre-studio doctor`
Performs complete environment diagnostics:
- Node.js runtime and architecture
- SQLite database connectivity and integrity
- Verification of external tools (`rizin`, `rabin2`, `aapt2`, `apksigner`, `jadx`, `apktool`)

### `sre-studio provider`
Inspect registered capability providers.
- `sre-studio provider list`: List active providers and their versions.
- `sre-studio provider test <providerId>`: Run verification checks on a provider.

### `sre-studio close`
Closes the investigation session.
- `--reason <completed|cancelled|error>`: Closure reason.
- `--summary`: Output final executive summary upon closing.

