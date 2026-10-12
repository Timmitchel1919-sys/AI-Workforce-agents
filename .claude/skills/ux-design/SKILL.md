---
name: ux-design
description: Design a new user interface component, page, or user flow, or restructure an existing UX architecture in alignment with design system tokens.
---

# UX Design Command (Claude Code)

Execute the universal UX design and specification workflow defined in [ux-intelligence/commands/ux-design.md](../../../ux-intelligence/commands/ux-design.md).

## Invocation
- Slash command: `/ux-design [feature_description_or_target]`
- Skill name: `ux-design`

## Workflow Summary
1. **Analyze Intent**: Determine user goals, target persona, and workflow requirements.
2. **Design System Alignment**: Resolve tokens in `ui/src/styles/tokens.css`, `os-theme.css`, and `glass-panels.css`.
3. **Information Architecture**: Define page grid, component hierarchy, and user interaction flow.
4. **Specification**: Specify responsive layouts, ARIA attributes, and 8 interaction states.
5. **Implementation**: When authorized, implement clean React 19 / TypeScript components.
6. **Validation**: Execute `npm run typecheck` and `npm run test` in `ui/`.
