---
name: ux-review
description: Review UI implementation quality, design specification compliance, code quality, usability, and accessibility of proposed frontend changes.
---

# UX Review Skill (Codex)

Execute the universal UX implementation review workflow defined in [ux-intelligence/commands/ux-review.md](../../../ux-intelligence/commands/ux-review.md).

## Usage
Invoke this skill with a target component, PR, or file list:
- Explicit invocation: `$ux-review <target_or_diff>`
- Task invocation: "Review UI implementation for `ui/src/pages/AuditLog/AuditLogPage.tsx`"

## Instructions
1. Read and execute the workflow in [ux-intelligence/commands/ux-review.md](../../../ux-intelligence/commands/ux-review.md).
2. Compare code implementation against design specifications and [ux-intelligence/standards.md](../../../ux-intelligence/standards.md).
3. Review is strictly **read-only** by default. Do not mutate source code during review.
4. Execute validation tools: TypeScript typecheck (`npm run typecheck`), component tests (`npm run test` in `ui/`), and linter (`npm run lint`).
5. Separate findings into **BLOCKING ISSUES** and **NON-BLOCKING SUGGESTIONS**.
6. Never auto-approve implementations with failing tests, type errors, or critical accessibility violations.
7. Issue a clear final verdict: `APPROVE`, `REVISE`, or `REJECT`.
