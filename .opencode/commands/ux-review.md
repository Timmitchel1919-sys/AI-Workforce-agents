---
description: Review UI implementation quality, design specification compliance, code quality, usability, and accessibility.
arguments:
  target:
    description: Target UI path, PR diff, or implementation files to review
    required: false
---

# /ux-review Command (OpenCode)

You are executing the AI Workforce OS universal UX review command.

Target: $ARGV

## Instructions
1. Load and follow the shared review workflow in `ux-intelligence/commands/ux-review.md`.
2. Review is **read-only** by default. Do not modify files during review.
3. Inspect implementation `$ARGV` against design specifications, `ux-intelligence/standards.md`, and WCAG 2.1 AA rules.
4. Execute standard validation commands: `npm run typecheck`, `npm run test` in `ui/`, and `npm run lint`.
5. Classify findings into **BLOCKING ISSUES** and **NON-BLOCKING SUGGESTIONS**.
6. Never auto-approve implementations with failing tests, type errors, or critical accessibility bugs.
7. Issue a formal verdict (`APPROVE`, `REVISE`, or `REJECT`) with actionable remediation feedback.
