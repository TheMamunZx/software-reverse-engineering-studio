# Internal module: web-app-analyzer

> Adapted from the original `web-app-analyzer` engineering playbook. This file is an internal reference, not a separately discoverable skill.

# web-app-analyzer

## Purpose
Document how an authorized web app is assembled and how its user journeys operate.

## Use this skill when
Use this skill when the task materially requires: routes, DOM structure, assets, client bundles, network calls, accessibility, and visible state transitions.

## Scope
Routes, DOM structure, assets, client bundles, network calls, accessibility, and visible state transitions.

## Out of scope
Do not scrape private data, evade authentication, bypass anti-abuse controls, or copy proprietary assets wholesale.

## Required inputs
Target URL or local source, authorization, browser scope, test accounts where approved, analysis questions.

## Workflow
1. Confirm the target is public or authorized for inspection.
2. Inventory pages and user journeys without collecting unrelated personal data.
3. Inspect rendered structure, assets, network requests, and client behavior.
4. Map visible actions to observed requests and state changes.
5. Record responsive, accessibility, and error-state behavior.
6. Separate observations from inferred implementation details.

## Expected outputs
Page inventory, route map, UI/component observations, request map, accessibility and behavior notes.

## Quality gates
Every finding points to observed evidence; unknown backend behavior is not guessed.

## Handoffs and collaboration
Coordinate with: software-reverse-engineer, frontend-engineer, api-traffic-analyzer, ui-ux-engineer. Load another skill only when its distinct responsibility is needed. Keep the boundary between this skill and collaborators explicit.

## Operating rules
- Inspect the existing project instructions, code, configuration, and conventions before proposing changes.
- Do not invent tools, APIs, model IDs, capabilities, test results, citations, or completed artifacts. Verify them.
- Prefer the smallest maintainable implementation that satisfies the stated requirements.
- Preserve existing working behavior; identify breaking changes and migration needs before making them.
- Protect credentials and personal data. Use environment variables or a secret manager; never put secrets in source files, prompts, logs, or generated examples.
- Ask for approval before paid services, production changes, external publication, destructive actions, or large batch jobs.
- Report exactly what changed, what was tested, test results, and what remains unverified.
