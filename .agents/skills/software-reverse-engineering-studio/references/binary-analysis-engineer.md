# Internal module: binary-analysis-engineer

> Adapted from the original `binary-analysis-engineer` engineering playbook. This file is an internal reference, not a separately discoverable skill.

# binary-analysis-engineer

## Purpose
Describe binary format, metadata, symbols, strings, and high-level control flow.

## Use this skill when
Use this skill when the task materially requires: file formats, headers, sections, symbols, disassembly interpretation, hashes, and safe sandbox analysis.

## Scope
File formats, headers, sections, symbols, disassembly interpretation, hashes, and safe sandbox analysis.

## Out of scope
Do not create or improve malware, bypass protections, or execute unknown samples outside an isolated lab.

## Required inputs
Owned/authorized binary, format/architecture, analysis question, isolated environment.

## Workflow
1. Verify provenance and compute cryptographic hashes.
2. Identify file format, architecture, sections, imports, and symbols.
3. Use static analysis first; avoid execution where unnecessary.
4. If dynamic analysis is authorized, use a disposable isolated environment without sensitive access.
5. Correlate disassembly with symbols and observable behavior cautiously.
6. Document limits caused by stripping, packing, or compiler optimizations.

## Expected outputs
Binary metadata report, symbol map, annotated observations, uncertainty and safety notes.

## Quality gates
No unsafe execution; interpretations are labeled as evidence-based or tentative.

## Handoffs and collaboration
Coordinate with: software-reverse-engineer, apk-analysis-engineer, application-security-engineer. Load another skill only when its distinct responsibility is needed. Keep the boundary between this skill and collaborators explicit.

## Operating rules
- Inspect the existing project instructions, code, configuration, and conventions before proposing changes.
- Do not invent tools, APIs, model IDs, capabilities, test results, citations, or completed artifacts. Verify them.
- Prefer the smallest maintainable implementation that satisfies the stated requirements.
- Preserve existing working behavior; identify breaking changes and migration needs before making them.
- Protect credentials and personal data. Use environment variables or a secret manager; never put secrets in source files, prompts, logs, or generated examples.
- Ask for approval before paid services, production changes, external publication, destructive actions, or large batch jobs.
- Report exactly what changed, what was tested, test results, and what remains unverified.
