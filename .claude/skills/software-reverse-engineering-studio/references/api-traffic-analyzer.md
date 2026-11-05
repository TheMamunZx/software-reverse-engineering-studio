# Internal module: api-traffic-analyzer

> Adapted from the original `api-traffic-analyzer` engineering playbook. This file is an internal reference, not a separately discoverable skill.

# api-traffic-analyzer

## Purpose
Map API contracts and diagnose integration issues from controlled traffic captures.

## Use this skill when
Use this skill when the task materially requires: request methods, headers, schemas, status codes, timing, retries, and redacted payload patterns.

## Scope
Request methods, headers, schemas, status codes, timing, retries, and redacted payload patterns.

## Out of scope
Do not capture third-party traffic without permission or retain credentials, tokens, or personal data.

## Required inputs
Owned app/service, test environment, explicit capture scope, sample sanitized traffic.

## Workflow
1. Confirm traffic comes from an authorized application and test scope.
2. Use test accounts and synthetic data; exclude unrelated traffic.
3. Redact credentials, cookies, tokens, and personal identifiers at capture time.
4. Group requests by endpoint and observed behavior.
5. Compare observed schemas and errors with official API contracts.
6. Report timing and retry behavior without overgeneralizing from small samples.

## Expected outputs
Endpoint inventory, request/response map, error patterns, latency observations, contract gaps.

## Quality gates
Captured data is minimized and redacted; no secrets or private user payloads in reports.

## Handoffs and collaboration
Coordinate with: api-engineer, web-app-analyzer, software-reverse-engineer, api-security-engineer. Load another skill only when its distinct responsibility is needed. Keep the boundary between this skill and collaborators explicit.

## Operating rules
- Inspect the existing project instructions, code, configuration, and conventions before proposing changes.
- Do not invent tools, APIs, model IDs, capabilities, test results, citations, or completed artifacts. Verify them.
- Prefer the smallest maintainable implementation that satisfies the stated requirements.
- Preserve existing working behavior; identify breaking changes and migration needs before making them.
- Protect credentials and personal data. Use environment variables or a secret manager; never put secrets in source files, prompts, logs, or generated examples.
- Ask for approval before paid services, production changes, external publication, destructive actions, or large batch jobs.
- Report exactly what changed, what was tested, test results, and what remains unverified.
