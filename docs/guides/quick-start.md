# Quick Start Guide

This guide walks you through setting up an investigation project, adding target binaries and APKs, running static analysis, querying evidence, and exporting reports.

## 1. Initialize a Project

Create a dedicated investigation workspace:

```bash
mkdir my-investigation
cd my-investigation
sre-studio init . --name "Sample Binary Analysis" --scope "Authorized testing" --auth-type owner
```

This creates:
- `.sre/config.json`: Project configuration and resource limits.
- `.sre/boundaries.json`: Fail-closed authorization boundaries allowing registered targets.
- `.sre/investigation.db`: Embedded SQLite database initialized with schemas and foreign keys.

## 2. Register Targets

Register target files to your investigation session:

```bash
# Register a primary Windows PE executable
sre-studio target add ../tests/fixtures/sample-binaries/sample.exe --type binary --role primary

# Register a secondary Android APK
sre-studio target add ../tests/fixtures/sample-apks/sample.apk --type android --role secondary

# List registered targets
sre-studio target list
```

## 3. Check Available Capabilities

Inspect the analysis capabilities registered in your environment:

```bash
sre-studio capabilities
```

Available capabilities will list active providers (`binary`, `android`) and their supported analysis passes (e.g. `binary.info`, `binary.sections`, `binary.strings`, `android.manifest`, `android.permissions`, `android.signatures`).

## 4. Run Analysis

Execute static analysis against an authorized target:

```bash
# Run binary header and structure analysis
sre-studio analyze binary.info

# Run Android manifest & permission extraction
sre-studio analyze android.manifest
```

> **Security Note**: Target files are analyzed using pure static inspection via sandboxed child processes. Binaries and APKs are **never executed**.

## 5. Query Evidence & Findings

Query findings stored in the project's SQLite evidence database:

```bash
# View summary statistics
sre-studio evidence summary

# Query findings by severity
sre-studio evidence list --severity high

# Query findings by category
sre-studio evidence list --category android.manifest

# Inspect details of a specific finding
sre-studio evidence get fnd_...
```

## 6. Generate Investigation Reports

Export the investigation findings in Markdown, HTML, or standard SARIF 2.1.0 format:

```bash
# Technical Markdown report
sre-studio report --format markdown --output report.md

# Executive HTML report
sre-studio report --format html --output report.html

# OASIS SARIF 2.1.0 JSON format for CI/CD and security scanners
sre-studio report --format sarif --output findings.sarif
```

## 7. Close Session

When the investigation is finished, close the session cleanly:

```bash
sre-studio close --reason completed
```

