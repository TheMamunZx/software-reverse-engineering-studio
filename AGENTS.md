# Agent operating guide

- The single discoverable entry point is `.claude/skills/software-reverse-engineering-studio/SKILL.md`.
- Specialist modules are internal references under that skill's `references/` directory.
- Inspect the target project before editing. Preserve its conventions and working behavior.
- Never invent tool, API, provider, or test capabilities. Verify them in the current environment.
- Ask before paid usage, destructive operations, production deployment, or external publication.
- Never commit secrets or private credentials.
- Report actual tests and unresolved limitations honestly.
