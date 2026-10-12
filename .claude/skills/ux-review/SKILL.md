---
name: ux-review
description: Review UI implementation quality, design specification compliance, code quality, usability, and accessibility of proposed frontend changes.
---

# UX Review Command (Claude Code)

Execute the universal UX review and quality evaluation workflow defined in [ux-intelligence/commands/ux-review.md](../../../ux-intelligence/commands/ux-review.md).

## Invocation
- Slash command: `/ux-review [target_component_or_diff]`
- Skill name: `ux-review`

## Workflow Summary
1. **Inspect Implementation**: Inspect target TSX/CSS components and git diff.
2. **Compare Specs**: Evaluate against design specs, WCAG 2.1 AA, and [ux-intelligence/standards.md](../../../ux-intelligence/standards.md).
3. **Read-Only Mode**: Review code without mutating files.
4. **Execute Tools**: Run `npm run typecheck`, `npm run test` in `ui/`, and `npm run lint`.
5. **Classify Findings**: Separate into **BLOCKING ISSUES** and **NON-BLOCKING SUGGESTIONS**.
6. **Verdict**: Issue formal `APPROVE`, `REVISE`, or `REJECT` verdict with actionable code feedback.
