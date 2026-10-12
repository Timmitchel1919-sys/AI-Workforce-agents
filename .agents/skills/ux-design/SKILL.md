---
name: ux-design
description: Design a new user interface component, page, or user flow, or restructure an existing UX architecture in alignment with design system tokens.
---

# UX Design Skill (Codex)

Execute the universal UX design and specification workflow defined in [ux-intelligence/commands/ux-design.md](../../../ux-intelligence/commands/ux-design.md).

## Usage
Invoke this skill with a design task, target page, or feature requirement:
- Explicit invocation: `$ux-design <feature_or_target>`
- Task invocation: "Design a new agent deployment modal component in `ui/src/components/`"

## Instructions
1. Read and execute the workflow in [ux-intelligence/commands/ux-design.md](../../../ux-intelligence/commands/ux-design.md).
2. Default to AI Workforce OS project branding and design tokens in `ui/src/styles/tokens.css` and `os-theme.css`.
3. Adhere to UX & Accessibility standards in [ux-intelligence/standards.md](../../../ux-intelligence/standards.md).
4. Define information architecture, layout grid, interaction flows, and ARIA attributes.
5. Implement authorized React 19 / TypeScript components when requested by the user.
6. Validate output using `npm run typecheck` and `npm run test` in `ui/`.
