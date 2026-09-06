# AI Workforce — Agents

Reliable foundation for an AI agent workforce: a declarative agent registry, a
deterministic task lifecycle, structured agent-to-agent handoffs, a minimal
deterministic orchestrator, deny-by-default permissions, human approval records,
project-isolated context, and a structured audit log — all behind
**provider- and project-agnostic contracts**.

> **Phase 1** — foundation only. No persistence, no network calls, no
> autonomous planning, and no real project integrations. Money Mind will be the
> first real integration in a later phase; its source is never copied here.

## Stack

- **TypeScript** (strict) on **Node.js ≥ 20**, ESM (`NodeNext`)
- Tests: built-in `node:test` + `node:assert/strict`
- Build: `tsc` only
- **Zero runtime dependencies**

## Layout

| Path | Purpose |
| --- | --- |
| [`contracts/`](contracts/index.ts) | Shared types + pure validators. No dependencies. |
| [`core/`](core/) | Registry, tasks, handoffs, permissions, approvals, context, audit, orchestrator. |
| [`adapters/`](adapters/) | Provider/project contracts + offline reference implementations. |
| [`tests/`](tests/foundation.test.ts) | Deterministic, offline tests for every component. |
| [`docs/`](docs/) | [Architecture](docs/architecture.md), [extension guide](docs/extending.md), [ADR-0001](docs/adr/0001-modular-provider-agnostic-workforce.md). |

## Commands

```bash
npm install        # dev dependencies only (typescript, @types/node)
npm run typecheck  # tsc --noEmit, strict
npm test           # compile + run node --test over dist/
npm run check      # typecheck + test
npm run build      # emit dist/
```

## Core components at a glance

| Component | Responsibility |
| --- | --- |
| `AgentRegistry` | Validate and store declarative agents; look up by capability / eligibility. |
| `TaskSystem` | Own the deterministic task lifecycle; reject illegal transitions. |
| `HandoffSystem` | Propose / accept / reject validated agent-to-agent handoffs. |
| `Orchestrator` | Validate → route to an eligible agent → dispatch → record. No autonomy. |
| `PermissionSystem` | Deny-by-default evaluation scoped by agent/project/tool/action/environment. |
| `ApprovalSystem` | Record human approvals: `requested → approved \| rejected \| expired`. |
| `ContextSystem` | Task / project / agent context, isolated per project. |
| `AuditLog` | Structured events to a pluggable local sink; queryable. |
| `ModelProvider` / `ToolProvider` / `ProjectAdapter` | Vendor- and project-neutral seams. |

## Extending

Read [docs/extending.md](docs/extending.md). Never let `core/` import an adapter
or a vendor SDK; put every external capability behind a contract; keep new
actions deny-by-default; add deterministic tests; never commit a secret.

## Security notes

- Deny-by-default permissions; least privilege declared per agent.
- Human approval is a recorded, first-class lifecycle.
- Project context does not cross project boundaries.
- No secrets in the repo. Providers read credentials from the environment at
  call time.
