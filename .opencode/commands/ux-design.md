---
description: Design a new user interface component, page, or user flow, or restructure an existing UX architecture.
arguments:
  target:
    description: Feature description, target UI path, or design requirement
    required: false
---

# /ux-design Command (OpenCode)

You are executing the AI Workforce OS universal UX design and specification command.

Target: $ARGV

## Instructions
1. Load and follow the shared design workflow in `ux-intelligence/commands/ux-design.md`.
2. Analyze user intent, key tasks, and target persona for `$ARGV`.
3. Default to project branding and design tokens in `ui/src/styles/tokens.css`, `os-theme.css`, and `glass-panels.css`.
4. Define information architecture, layout grids, interaction flows, and WCAG 2.1 AA accessibility specs.
5. When authorized, implement clean, modular React 19 / TypeScript components in `ui/src/components/` or `ui/src/pages/`.
6. Run verification tools (`npm run typecheck` and `npm run test` in `ui/`).
7. Deliver a design summary report detailing component architecture and accessibility features.
