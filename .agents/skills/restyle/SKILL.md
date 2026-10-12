---
name: restyle
description: Improve the visual appearance, styling consistency, and design token adherence of an existing interface while preserving business logic and API contracts.
---

# Restyle Skill (Codex)

Execute the universal UI restyling workflow defined in [ux-intelligence/commands/restyle.md](../../../ux-intelligence/commands/restyle.md).

## Usage
Invoke this skill with a target UI file, component, or restyling description:
- Explicit invocation: `$restyle <target_path>`
- Task invocation: "Restyle the governance security dashboard in `ui/src/pages/Governance/SecurityPage.tsx`"

## Instructions
1. Read and execute the workflow in [ux-intelligence/commands/restyle.md](../../../ux-intelligence/commands/restyle.md).
2. Adhere to project UX & Accessibility standards in [ux-intelligence/standards.md](../../../ux-intelligence/standards.md).
3. Preserve all business logic, component props, state handlers, and API contracts.
4. Align visual styling with existing tokens in `ui/src/styles/tokens.css`, `os-theme.css`, and `glass-panels.css`.
5. Verify all 8 interaction states and responsive breakpoints.
6. Validate output using `npm run typecheck` and component tests (`npm run test` in `ui/`).
