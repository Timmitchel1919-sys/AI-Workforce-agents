# AI Workforce OS — Universal UX Command Installation Guide

## 1. Overview
This guide documents the installation, invocation, and operational architecture of the four universal UX commands across **Codex**, **Claude Code**, and **OpenCode**:

* `/restyle` — Visual polish, token alignment, and interface refinement while strictly preserving business logic and API contracts.
* `/ux-audit` — Evidence-based UX, usability, and WCAG 2.1 AA accessibility audit.
* `/ux-design` — Information architecture, layout specifications, and component design aligned with project design tokens.
* `/ux-review` — Pre-merge implementation quality, accessibility, test, and typecheck review.

---

## 2. Directory Layout & Installation Paths

```
AI-Workforce-agents/
├── ux-intelligence/
│   ├── standards.md                     # Core UX & WCAG 2.1 AA standards
│   └── commands/                        # Shared canonical command workflows
│       ├── restyle.md
│       ├── ux-audit.md
│       ├── ux-design.md
│       └── ux-review.md
├── .agents/
│   └── skills/                          # Codex skills integration
│       ├── restyle/SKILL.md
│       ├── ux-audit/SKILL.md
│       ├── ux-design/SKILL.md
│       └── ux-review/SKILL.md
├── .claude/
│   └── skills/                          # Claude Code slash commands
│       ├── restyle/SKILL.md
│       ├── ux-audit/SKILL.md
│       ├── ux-design/SKILL.md
│       └── ux-review/SKILL.md
└── .opencode/
    └── commands/                        # OpenCode commands integration
        ├── restyle.md
        ├── ux-audit.md
        ├── ux-design.md
        └── ux-review.md
```

---

## 3. Invocation Examples by Platform

### 3.1 Codex (`.agents/skills/`)
In Codex environments supporting project-level skill discovery:
* **Restyle**: `$restyle ui/src/pages/Governance/SecurityPage.tsx`
* **UX Audit**: `$ux-audit ui/src/pages/Approvals/ApprovalsPage.tsx`
* **UX Design**: `$ux-design "Design an agent execution credentials drawer in ui/src/components/"`
* **UX Review**: `$ux-review ui/src/pages/AuditLog/AuditLogPage.tsx`

### 3.2 Claude Code (`.claude/skills/`)
In Claude Code CLI:
* **Restyle**: `/restyle ui/src/pages/Governance/SecurityPage.tsx`
* **UX Audit**: `/ux-audit ui/src/pages/Approvals/ApprovalsPage.tsx`
* **UX Design**: `/ux-design "Design an agent execution credentials drawer in ui/src/components/"`
* **UX Review**: `/ux-review ui/src/pages/AuditLog/AuditLogPage.tsx`

### 3.3 OpenCode (`.opencode/commands/`)
In OpenCode CLI:
* **Restyle**: `/restyle ui/src/pages/Governance/SecurityPage.tsx`
* **UX Audit**: `/ux-audit ui/src/pages/Approvals/ApprovalsPage.tsx`
* **UX Design**: `/ux-design "Design an agent execution credentials drawer in ui/src/components/"`
* **UX Review**: `/ux-review ui/src/pages/AuditLog/AuditLogPage.tsx`

---

## 4. Supported Tooling & Verification Commands
* **TypeScript Strict Mode**: `npm run typecheck`
* **UI Build & Bundle Check**: `cd ui && npm run build`
* **Component Testing**: `cd ui && npm test`
* **Linter & Code Standards**: `npm run lint`
* **Browser Accessibility Audit**: Supported via Chrome DevTools MCP or axe-core.

---

## 5. Security & Safety Principles
1. **Read-Only Audits & Reviews**: `/ux-audit` and `/ux-review` NEVER modify source code by default.
2. **Preserve Logic on Restyle**: `/restyle` strictly preserves existing state hooks, handler functions, props interfaces, and API endpoints.
3. **Approval Gates**: High-risk or destructive actions remain gated behind human approval.
4. **No Secret Leaks**: Credentials, auth tokens, and sensitive headers are never logged or hardcoded.

---

## 6. How to Use in Other Projects
To port these universal UX commands into another codebase:
1. Copy the `ux-intelligence/` directory into your project root.
2. Copy `.agents/skills/`, `.claude/skills/`, and `.opencode/commands/`.
3. Adjust relative paths in `standards.md` if your design tokens live in a different directory.
