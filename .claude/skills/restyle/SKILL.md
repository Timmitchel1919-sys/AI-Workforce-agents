---
name: restyle
description: Improve the visual appearance, styling consistency, and design token adherence of an existing interface while preserving business logic and API contracts.
---

# Restyle Command (Claude Code)

Execute the universal UI restyling workflow defined in [ux-intelligence/commands/restyle.md](../../../ux-intelligence/commands/restyle.md).

## Invocation
- Slash command: `/restyle [target_path_or_description]`
- Skill name: `restyle`

## Workflow Summary
1. **Inspect Target**: Inspect target UI components (`ui/src/...`) and design tokens (`tokens.css`, `os-theme.css`).
2. **Audit Inconsistencies**: Identify styling defects, improper font scales, or missing interaction states.
3. **Preserve Business Logic**: Keep existing props, event handlers, state hooks, and API contracts intact.
4. **Restyle**: Apply HSL token styling, glassmorphic panels, and smooth micro-animations.
5. **Validate**: Run `npm run typecheck` and `npm run test` in `ui/`.
6. **Report**: Output modified files and visual improvements.
