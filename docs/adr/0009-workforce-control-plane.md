# ADR-0009: Workforce Control & Operations Layer

**Status:** Accepted
**Date:** 2026-09-07
**Related:** [ADR-0001](0001-modular-provider-agnostic-workforce.md),
[ADR-0005](0005-general-agent-pattern.md),
[ADR-0007](0007-multi-agent-workflow-orchestration.md)

## Context

Phases 1–6 built the engine (registry, tasks, permissions, approvals, tools,
workflows, the Money Mind adapter). There was no way for a human to _see_ what
the workforce is doing or to _intervene_ (approve, cancel, retry, pause, disable
an agent). Phase 7 adds that control plane — without it becoming a second
orchestrator and without weakening any Phase 2A–6 security control.

## Decisions

### 1. A read/write application layer above core, not inside it

`control/` sits above `core/`. `WorkforceQueryService` (read) and
`WorkforceCommandService` (write) are the only surface a UI calls. They take a
`ControlPlaneContext` — every core service + two small stores — by injection.
`core` gains nothing except one optional hook (decision 4).

### 2. Views are derived, never invented

`control/derive.ts` is pure: it maps `Task` / `Workflow` / `Agent` / `Approval`
/ `Tool` / `AuditEvent` onto view models. Agent status comes from real task
states; workflow progress is `completed/total` task records; tool stats are
counted from `tool_execution` audit events. No fake metrics, no fake activity.

### 3. The "smallest necessary" operational state

Two flags, both control-plane-owned, both `Repository`-backed:
`AgentOperationalStore` (enabled/disabled per agent) and `WorkflowControlStore`
(paused per workflow). The `AgentRegistry` entry and the `Workflow` record are
never mutated by the control plane.

### 4. One injected `agentGate` on the orchestrator

`OrchestratorOptions.agentGate?: { isEnabled(agentId): boolean }`. When wired
(the control plane passes the `AgentOperationalStore`), a disabled agent's task
is `blocked` with `reason: "agent_disabled"` before dispatch — mirroring the
existing "no eligible agent" path. This is the _only_ core change: ~10 lines,
default off, no existing test affected. Tool access and workflow participation
are gated transitively (both go through `orchestrator.submit`).

### 5. Commands are a fixed pipeline; everything is audited

validate input → validate authorization → validate state → execute through core
→ **emit `control_command`** → return `ControlCommandResult`. Denied
(authorization) and rejected (input/state) outcomes are audited too. Approvals
are enacted via `ApprovalSystem` / `Orchestrator.recordApprovalDecision` /
`*.resume` — the UI never mutates approval state.

### 6. One new audit type

`control_command`, with `data.command` / `data.outcome` / `data.actor`
discriminators — same "don't grow the enum per feature" pattern as
`agent_activity` (ADR-0005) and `tool_execution` (ADR-0006).

### 7. Projects via a registry, not a hard-coded id

`core/registry/project-registry.ts` holds `ProjectAdapter` instances by id. The
control plane iterates it; Money Mind is the first registration. AIMS / Mastery
/ Tripod plug in with no control-plane change.

### 8. A dependency-free dashboard

The console is a pure render (`render.ts`) + a self-contained HTML builder
(`buildDashboardHtml`). No React/Vite/web-server dependency — that would
contradict the project's zero-runtime-dependency stance for a marginal gain.
Render functions are unit-tested with `node:test` (empty states, error banner,
XSS escaping, real-count rendering). An HTTP layer is documented, not shipped.

### 9. Roles: viewer / operator / admin

A three-tier capability map, deny-by-default. Not a full RBAC engine — the audit
asked for "a minimal operator authorization model" and "do not create excessive
RBAC complexity".

### 10. No real-time yet

Request/response only (`getDashboardSnapshot`). An event bus is explicitly
deferred; it would be designed as a subscription boundary first.

## Options considered

| Concern                   | Chosen                              | Rejected                                                                                        |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Control layer home        | `control/` above core               | inside `core/` (blurs the "not an orchestrator" line)                                           |
| Agent-disable enforcement | one injected `agentGate` predicate  | mutating the registry (breaks immutability); a full agent-lifecycle state machine (over-scoped) |
| Workflow pause            | control-plane guard flag            | a `paused` workflow status + engine changes (invasive; nothing to interrupt mid-run)            |
| Dashboard                 | pure render + HTML builder, no deps | React/Vite SPA + a bundled server (dependency + build-system change)                            |
| Audit events              | one `control_command` type          | one literal per command                                                                         |
| RBAC                      | 3 fixed roles                       | a policy/permission engine for operators                                                        |

## Consequences

- 288 tests (34 new); typecheck / lint / build all green; no regression.
- A future project adapter or General Agent appears in the console for free.
- Enforcement of "disabled agent" depends on the wiring layer passing the gate;
  documented, tested, default-safe.
- Health is honest-by-omission: unchecked components report `degraded`.
- Real-time updates, richer RBAC, and a shipped HTTP server are Phase 8+.
