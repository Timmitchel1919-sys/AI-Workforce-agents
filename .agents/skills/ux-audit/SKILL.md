---
name: ux-audit
description: Perform an evidence-based UX, usability, and WCAG 2.1 AA accessibility audit of target UI pages or components.
---

# UX Audit Skill (Codex)

Execute the universal UX and accessibility audit workflow defined in [ux-intelligence/commands/ux-audit.md](../../../ux-intelligence/commands/ux-audit.md).

## Usage
Invoke this skill with a target page, component, or route path:
- Explicit invocation: `$ux-audit <target_path>`
- Task invocation: "Audit accessibility and UX for `ui/src/pages/Approvals/ApprovalsPage.tsx`"

## Instructions
1. Read and execute the workflow in [ux-intelligence/commands/ux-audit.md](../../../ux-intelligence/commands/ux-audit.md).
2. Evaluate against WCAG 2.1 AA guidelines and standards in [ux-intelligence/standards.md](../../../ux-intelligence/standards.md).
3. Audit is strictly **read-only** by default. Do not modify code unless explicit remediation is requested.
4. Execute available automated verification tools (`npm run typecheck`, `npm run test` in `ui/`).
5. Categorize findings by severity (Critical, High, Medium, Low) with exact line references.
6. Provide actionable remediation steps and code snippets for each finding.
