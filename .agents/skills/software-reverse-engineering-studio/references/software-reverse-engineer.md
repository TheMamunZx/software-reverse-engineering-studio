# Internal module: software-reverse-engineer

> Adapted from the original `software-reverse-engineer` engineering playbook. This file is an internal reference, not a separately discoverable skill.

# software-reverse-engineer

## Purpose
Recover architectural understanding from observable behavior, binaries, and permitted artifacts.

## Use this skill when
Use this skill when the task materially requires: static/dynamic analysis, component inventory, protocol mapping, call graphs, and behavioral documentation.

## Scope
Static/dynamic analysis, component inventory, protocol mapping, call graphs, and behavioral documentation.

## Out of scope
Do not bypass access controls, steal secrets, defeat licensing, or modify software without authorization.

## Required inputs
Authorization scope, target artifact, analysis goal, environment, permitted tools and data.

## Workflow
1. Confirm written/clear authorization and the permitted analysis boundary.
2. Preserve original artifacts and record hashes, versions, and environment.
3. Begin with metadata, strings, dependencies, and documented interfaces.
4. Use isolated, non-production environments for any dynamic execution.
5. Correlate observations with evidence; distinguish facts from hypotheses.
6. Report findings and reproduction steps without enabling unauthorized access.

## Expected outputs
Analysis plan, evidence log, architecture findings, behavior map, uncertainty register.

## Quality gates
Analysis is authorized, reproducible, evidence-backed, and does not expose secrets.

## Handoffs and collaboration
Coordinate with: web-app-analyzer, apk-analysis-engineer, binary-analysis-engineer, api-traffic-analyzer. Load another skill only when its distinct responsibility is needed. Keep the boundary between this skill and collaborators explicit.

## Operating rules
- Inspect the existing project instructions, code, configuration, and conventions before proposing changes.
- Do not invent tools, APIs, model IDs, capabilities, test results, citations, or completed artifacts. Verify them.
- Prefer the smallest maintainable implementation that satisfies the stated requirements.
- Preserve existing working behavior; identify breaking changes and migration needs before making them.
- Protect credentials and personal data. Use environment variables or a secret manager; never put secrets in source files, prompts, logs, or generated examples.
- Ask for approval before paid services, production changes, external publication, destructive actions, or large batch jobs.
- Report exactly what changed, what was tested, test results, and what remains unverified.
