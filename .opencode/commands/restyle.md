---
description: Improve the visual appearance, styling consistency, and design token adherence of an existing interface while preserving business logic.
arguments:
  target:
    description: Target UI component, page path, or restyling requirements
    required: false
---

# /restyle Command (OpenCode)

You are executing the AI Workforce OS universal UI restyling command.

Target: $ARGV

## Instructions
1. Load and follow the shared restyling workflow in `ux-intelligence/commands/restyle.md`.
2. Adhere to project UX and accessibility standards in `ux-intelligence/standards.md`.
3. Inspect target UI component `$ARGV` and associated styling files.
4. Align styling with design tokens in `ui/src/styles/tokens.css`, `os-theme.css`, and `glass-panels.css`.
5. Guarantee that existing props, state handlers, business logic, and API contracts remain intact.
6. Validate responsiveness and WCAG 2.1 AA accessibility (focus rings, contrast ratios).
7. Run verification commands (`npm run typecheck` and `npm run test` in `ui/`).
8. Deliver a structured summary report of modified files and visual enhancements.
