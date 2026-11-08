---
name: software-reverse-engineering-studio
description: "Coordinate end-to-end software reverse engineering studio workflows from one master skill, loading specialist playbooks as needed."
---

# Software Reverse Engineering Studio

## Mission
Analyze software that the user owns or is authorized to inspect, document observable behavior, and create a lawful independent implementation without copying protected source code or bypassing access controls.

## Use this skill when
The user asks to create, extend, analyze, or deliver a software reverse engineering studio project and expects one coordinated workflow rather than manually selecting individual specialist skills.

## Invocation contract
This is the only selectable skill in this repository. The specialist modules below are internal reference playbooks, not separate skills to invoke. Start from the user's brief, load only relevant references, and coordinate the complete workflow.

## Required inputs
Infer what is clear from the user's brief and repository. Identify only essential missing information. Typical inputs include goal, target users/platform, scope, references, constraints, existing stack, output format, budget, deadline, and acceptance criteria. Ask one concise clarification only when a missing fact blocks safe or correct execution; otherwise state reasonable assumptions and proceed.

## Operating protocol
1. Inspect the current repository, project instructions, files, configuration, and existing conventions before editing.
2. Translate the request into deliverables, explicit assumptions, non-goals, acceptance criteria, and risks.
3. Build a short phased plan. Prefer a working vertical slice over broad scaffolding that does not run.
4. Read the relevant internal references from the map below. Do not load unrelated modules or duplicate work.
5. Discover the actual tools, dependencies, APIs, providers, and runtime capabilities available in the current environment. Never invent tool names, provider availability, model IDs, endpoints, test results, or completed outputs.
6. Implement the requested outcome in the existing project. Preserve working behavior and avoid unnecessary rewrites.
7. Validate with the strongest available automated and manual checks. Fix issues found, then re-run the relevant checks.
8. Report exact files changed, commands/tests executed and results, deliverables created, unresolved issues, and what remains unverified.

## Internal specialist reference map
- `software-reverse-engineer` — read `references/software-reverse-engineer.md` when this capability is needed.
- `web-app-analyzer` — read `references/web-app-analyzer.md` when this capability is needed.
- `apk-analysis-engineer` — read `references/apk-analysis-engineer.md` when this capability is needed.
- `binary-analysis-engineer` — read `references/binary-analysis-engineer.md` when this capability is needed.
- `api-traffic-analyzer` — read `references/api-traffic-analyzer.md` when this capability is needed.
- `human-centered-product-design` — read `references/human-centered-product-design.md` when this capability is needed.
- `design-quality-critic` — read `references/design-quality-critic.md` when this capability is needed.
- `product-experience-engineer` — read `references/product-experience-engineer.md` when this capability is needed.

## Coordinated workflow
1. Confirm ownership or authorization, target scope, and prohibited actions.
2. Inventory supplied files, URLs, package metadata, observable screens, and runtime conditions.
3. Gather permitted static and dynamic evidence; keep observations separate from hypotheses.
4. Map interfaces, navigation, data flows, API contracts, states, and dependencies.
5. Create a behavior specification and confidence/evidence ledger.
6. Design an independent implementation using original code and assets.
7. Test functional parity against permitted observations and record differences.
8. Produce a technical report with evidence, assumptions, risks, and reproducible steps.

## Expected deliverables
- evidence-backed behavior specification
- component, route, and data-flow maps
- API observations and uncertainty register
- independent implementation plan or code
- parity test report and legal/safety notes

## Quality gates
- Requirements map to implemented behavior or clearly documented non-goals.
- The project builds/runs with available dependencies, or blockers are stated with evidence.
- Tests cover critical user flows or critical subsystem invariants.
- Security, privacy, accessibility, performance, and failure states are considered where relevant.
- Documentation matches the delivered implementation.
- No capability is described as complete unless the corresponding artifact exists and has been checked.

## Human-centered quality requirement
For any user-facing interface, load the human-centered design, design critique, and product-experience references. Apply them as quality gates throughout the work, not as a last-minute decoration pass. The result should be distinctive and fit the product domain, not a generic AI template.


## Evidence, rights, and scope
- Work only on assets, systems, accounts, and targets the user owns or is authorized to use.
- Distinguish observed facts, hypotheses, assumptions, and unverified behavior.
- Do not bypass authentication, paywalls, DRM, safety controls, or access restrictions.
- Do not copy proprietary source code, private data, protected brand assets, or confidential material.

## Approval gates
Ask before paid API/service usage, production deployment, public publication, destructive changes, external account actions, large cloud jobs, or changes that can incur charges. Do not ask for approval for ordinary reversible local edits within the user's requested scope.

## Stop conditions
Stop and explain the blocker when required permissions, credentials, source material, tools, dependencies, or target hardware are unavailable. Continue with independent work where possible, but do not simulate unavailable external generation or claim a final build succeeded.

## Final response format
Summarize: outcome; key implementation; files/artifacts; validation results; required user actions; known limitations. Be explicit about partial completion.
