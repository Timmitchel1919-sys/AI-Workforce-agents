---
name: ux-audit
description: Perform an evidence-based UX, usability, and WCAG 2.1 AA accessibility audit of target UI pages or components.
---

# UX Audit Command (Claude Code)

Execute the universal UX and accessibility audit workflow defined in [ux-intelligence/commands/ux-audit.md](../../../ux-intelligence/commands/ux-audit.md).

## Invocation
- Slash command: `/ux-audit [target_path_or_route]`
- Skill name: `ux-audit`

## Workflow Summary
1. **Target Identification**: Identify target UI components (`ui/src/pages/...` or `ui/src/components/...`).
2. **Read-Only Audit**: Conduct evidence-based evaluation against WCAG 2.1 AA and [ux-intelligence/standards.md](../../../ux-intelligence/standards.md).
3. **Multi-Dimension Analysis**: Check color contrast, keyboard focus rings, semantic HTML, ARIA attributes, touch targets, and interaction states.
4. **Validation Tooling**: Execute `npm run typecheck` and `npm run test` in `ui/`.
5. **Classify Severities**: Categorize findings as Critical, High, Medium, or Low with exact line numbers.
6. **Report**: Deliver structured report with reproduction steps and code remediation snippets.
