---
description: Perform an evidence-based UX, usability, and WCAG 2.1 AA accessibility audit of target UI pages or components.
arguments:
  target:
    description: Target UI page, component path, or route to audit
    required: false
---

# /ux-audit Command (OpenCode)

You are executing the AI Workforce OS universal UX and accessibility audit command.

Target: $ARGV

## Instructions
1. Load and follow the shared audit workflow in `ux-intelligence/commands/ux-audit.md`.
2. Audit is **read-only** by default. Do not modify source code unless explicitly requested.
3. Inspect target UI component/page `$ARGV` against WCAG 2.1 AA and `ux-intelligence/standards.md`.
4. Evaluate color contrast, keyboard focus indicators, semantic HTML, ARIA attributes, touch targets, and interaction states.
5. Execute available verification tools (`npm run typecheck`, `npm run test` in `ui/`).
6. Classify findings into Critical, High, Medium, and Low severity tiers with exact file locations.
7. Output a structured audit report with reproduction steps and before/after code remediation snippets.
