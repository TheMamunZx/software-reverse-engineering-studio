# Internal module: apk-analysis-engineer

> Adapted from the original `apk-analysis-engineer` engineering playbook. This file is an internal reference, not a separately discoverable skill.

# apk-analysis-engineer

## Purpose
Understand APK packaging, manifest, resources, dependencies, and app behavior.

## Use this skill when
Use this skill when the task materially requires: package metadata, manifest permissions, resources, DEX structure, signing information, and dependency inventory.

## Scope
Package metadata, manifest permissions, resources, DEX structure, signing information, and dependency inventory.

## Out of scope
Do not bypass paid features, licensing, account controls, or repurpose private code; do not install unknown APKs on a personal device.

## Required inputs
APK provenance, authorization, package/version, analysis objective, isolated tooling environment.

## Workflow
1. Confirm the APK is yours or you have permission to analyze it.
2. Hash and preserve the original file; do not alter evidence.
3. Inspect package metadata, manifest, permissions, components, and resources.
4. Review dependency and signing information using reputable static tools.
5. If dynamic testing is needed, use an isolated emulator and safe test account.
6. Report uncertainties and avoid claiming source-level behavior from metadata alone.

## Expected outputs
APK inventory, permission summary, dependency list, signing metadata, static-analysis notes.

## Quality gates
No untrusted executable is run on the host; findings are traceable to the artifact.

## Handoffs and collaboration
Coordinate with: software-reverse-engineer, android-app-engineer, binary-analysis-engineer, application-security-engineer. Load another skill only when its distinct responsibility is needed. Keep the boundary between this skill and collaborators explicit.

## Operating rules
- Inspect the existing project instructions, code, configuration, and conventions before proposing changes.
- Do not invent tools, APIs, model IDs, capabilities, test results, citations, or completed artifacts. Verify them.
- Prefer the smallest maintainable implementation that satisfies the stated requirements.
- Preserve existing working behavior; identify breaking changes and migration needs before making them.
- Protect credentials and personal data. Use environment variables or a secret manager; never put secrets in source files, prompts, logs, or generated examples.
- Ask for approval before paid services, production changes, external publication, destructive actions, or large batch jobs.
- Report exactly what changed, what was tested, test results, and what remains unverified.
