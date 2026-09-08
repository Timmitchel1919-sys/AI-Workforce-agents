# Control Plane

The Control Plane is the backend/application-service layer through which a human
operator — and, later, a UI, an HTTP API, and external clients — safely observes
and controls the AI Workforce. It is **not** an orchestrator: it never plans,
never dispatches, and never mutates domain state directly. It reads through core
services and acts through them.

```
                 CONTROL PLANE
                       │
              ┌────────┴────────┐
              ▼                 ▼
            QUERIES          COMMANDS
              │                 │
              └────────┬────────┘
                       ▼
                     CORE
                       │
              ┌────────┴────────┐
              ▼                 ▼
          PERMISSIONS        APPROVAL
              │                 │
              └────────┬────────┘
                       ▼
                     AUDIT
```

> Phases 7B (Firebase) and 7C (web UI) are **not** built. This layer is designed
> so they attach as adapters behind the ports in
> [§11](#11-firebase-boundary) without changing `control/`.

## 1. Control Plane purpose

Give an operator enough visibility to understand what the workforce is doing, and
exactly enough control to intervene:

- **See** — workforce status, agents, tasks, workflows, approvals, projects,
  tools, audit events, system health.
- **Act** — approve / reject an approval, cancel / retry a task, pause / resume /
  cancel a workflow, enable / disable an agent.

Every action is validated, authorized, state-checked, executed through a core
service, and audited. The Control Plane adds no capability that core does not
already expose, and removes none of core's guarantees (deny-by-default
permissions, human approval, project isolation, auditability).

## 2. Architecture

`UI → control services → core → contracts`, one way. Nothing in `control/`
imports a database, a filesystem, a shell, a browser API, a framework, or a
credential.

| Path                                | Role                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `contracts/control.ts`              | Operator roles + capabilities, command inputs/results, error kinds, health/DTO view types.                                    |
| `control/context.ts`                | `ControlPlaneContext` — the injected bundle of core services + the two control-plane stores + optional ports.                 |
| `control/ports.ts`                  | `OperatorDirectory`, `ControlEventPublisher`, `ControlRepository<T>`, provider/tool health probes — seams for later adapters. |
| `control/errors.ts`                 | Control error taxonomy over `WorkforceError`; `classifyErrorKind`.                                                            |
| `control/correlation.ts`            | `createCorrelationId` / `resolveCorrelationId`.                                                                               |
| `control/stores.ts`                 | `AgentOperationalStore` (enabled/disabled), `WorkflowControlStore` (paused) — each behind an injected `Repository<T>`.        |
| `control/redaction.ts` / `risk.ts`  | Secret redaction; deterministic approval-risk classification.                                                                 |
| `control/health.ts`                 | `HealthProbe`, `buildSystemHealth`, `unverifiedComponent`.                                                                    |
| `control/derive.ts`                 | Pure `Task`/`Workflow`/`Agent`/`Approval`/`Tool`/`AuditEvent` → view-model derivation; cursor pagination.                     |
| `control/services/`                 | `WorkforceQueryService` (read) and `WorkforceCommandService` (write).                                                         |
| `core/registry/project-registry.ts` | `ProjectRegistry` — projects are resolved by id, never hard-coded.                                                            |
| `core` change (Phase 7)             | `OrchestratorOptions.agentGate` — one optional predicate so a disabled agent gets no new tasks.                               |

Phase 7A changes **no** `core` behaviour — it adds the correlation helper (which
reuses `core/shared.ts`'s `createId`), the ports, the error taxonomy, `UNKNOWN`
health, and query filters, all within `control/` and `contracts/`.

## 3. Query layer

`WorkforceQueryService(ctx)` is read-only and returns safe DTOs — never a mutable
domain object. Every method takes an `OperatorPrincipal`, requires the `view`
capability, and is scoped to the operator's projects.

| Method                                   | Returns                      | Notes                                                                              |
| ---------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `getWorkforceStatus(p)`                  | `WorkforceStatus`            | Real counts (below); `recentActivity` is redacted audit data.                      |
| `getAgents(p)` / `getAgent(p, id)`       | `AgentView[]`                | Status derived from actual task state; no credentials or provider config.          |
| `getTasks(p, q)` / `getTask(p, id)`      | `PageResult<TaskView>`       | Filters + bounded pages; full input/output/context never returned.                 |
| `getWorkflows(p)` / `getWorkflow(p, id)` | `WorkflowView[]`             | `progress` = completed / total real task records.                                  |
| `getApprovals(p, {status?})`             | `ApprovalView[]`             | Deterministic `risk`; sensitive fields redacted.                                   |
| `getProjects(p)` / `getProject(p, id)`   | `ProjectView[]`              | Discovered from `ProjectRegistry`; failing adapter → `adapterStatus: unavailable`. |
| `getTools(p)` / `getTool(p, id)`         | `ToolView[]`                 | Policy metadata + execution stats only — never keys, tokens, headers.              |
| `getAuditEvents(p, q)`                   | `PageResult<AuditEventView>` | Filters incl. `actor` / `correlationId`; bounded pages; redacted.                  |
| `getSystemHealth(p)`                     | `SystemHealth`               | Only measurable components (§10). `getHealth` is a deprecated alias.               |
| `getDashboardSnapshot(p)`                | `DashboardSnapshot`          | One bounded bundle; on partial failure carries `error` and empty lists.            |

### Workforce status

`WorkforceStatus.counts` are all derived from live state: `activeWorkflows`,
`queuedTasks`, `runningTasks`, `blockedTasks`, `awaitingApproval`, `failedTasks`,
`completedTasks`, `cancelledTasks`, `registeredAgents`, `disabledAgents`,
`availableTools`, `registeredProjects`, plus overall `status`. No metric is
fabricated; a metric that cannot be derived is either added as a real query or
omitted.

### Task filters

`taskId, workflowId, projectId, agentId, status, priority, since` / `until`
(updatedAt), `createdAfter` / `createdBefore` (createdAt), `failedOnly`, `limit`,
`cursor`. Results are always bounded (`DEFAULT_PAGE` 25, `MAX_PAGE` 200).

### System health (`getSystemHealth`)

Reports only components it can actually measure in-process: `application`,
`persistence` (a real read), `audit`, `tool-registry`, `projects`. Anything not
wired to a real probe — `model-provider` today — is reported `unknown` (not
`healthy`, not `degraded`): unmeasured, not impaired. Statuses are
`HEALTHY | DEGRADED | UNAVAILABLE | UNKNOWN`; overall is the worst component with
precedence `unavailable > degraded > unknown > healthy`. No probe makes an
external network call purely to manufacture a health signal. Real provider / tool
probes attach later as `ProviderHealthProbe` / `ToolHealthProbe` via
`ctx.healthProbes`. `getHealth` is a deprecated alias for `getSystemHealth`.

## 4. Command layer

`WorkforceCommandService(ctx)` is the only write surface. Commands are explicit
methods — there is **no** generic `execute(command)`, `runShell`, `runQuery`, or
`executeTool`. Each method takes `(principal, input, options?)` where
`options.correlationId` is optional (§8).

| Command                            | Core path                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `approve` / `reject`               | `ApprovalSystem` via `Orchestrator.recordApprovalDecision`, then best-effort `*.resume`                                      |
| `cancelTask`                       | `TaskSystem.transition(…, "cancelled")`                                                                                      |
| `retryTask`                        | `TaskSystem.transition(…, "queued")` — failed-only, retryable-reason-only, operator cap (default 3), workflow tasks rejected |
| `pauseWorkflow` / `resumeWorkflow` | `WorkflowControlStore` guard flag (+ `WorkflowEngine.resume` when awaiting approval)                                         |
| `cancelWorkflow`                   | `WorkflowSystem.transition(…, "cancelled")`                                                                                  |
| `disableAgent` / `enableAgent`     | `AgentOperationalStore` — **admin only**                                                                                     |

### Command pipeline

```
REQUEST → VALIDATION → AUTHORIZATION → STATE VALIDATION → CORE OPERATION → AUDIT EVENT → RESULT
```

1. **Validation** — input shape. Failure → `rejected` / `invalid_request`.
2. **Authorization** — role capability + project scope. Failure → `denied` /
   `forbidden`.
3. **State validation** — resource exists and is in a legal state. Failure →
   `rejected` / `not_found` or `invalid_state`.
4. **Core operation** — through the service in the table above. A fault in the
   approval subsystem → `rejected` / `approval_failure` (never a stack trace).
5. **Audit event** — a `control_command` event **always**, including denied and
   rejected outcomes.
6. **Result** — `ControlCommandResult { command, outcome, ok, errorKind?, reason,
resourceId?, correlationId, details, auditEventId, timestamp }`.

`outcome` is `executed | denied | rejected`; `errorKind` refines every
non-`executed` outcome (§9).

## 5. Authorization

Three roles, deny-by-default, no RBAC engine
(`contracts/control.ts::ROLE_CAPABILITIES`):

| Role       | Capabilities                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `viewer`   | `view`                                                                                                      |
| `operator` | `view` + `approve` `reject` `cancel_task` `retry_task` `pause_workflow` `resume_workflow` `cancel_workflow` |
| `admin`    | operator + `disable_agent` `enable_agent`                                                                   |

Authorization is enforced **inside the services** from the `OperatorPrincipal`
argument — `validateOperatorPrincipal` then `operatorCan` /
`operatorCanAccessProject` on every query and command. The UI is **not** a trust
boundary. An unknown role has no capabilities (deny-by-default) and is refused
everything.

## 6. Project scoping

`OperatorPrincipal.allowedProjects` is `"*"` or an explicit id list. Every list
query filters to visible projects; every command re-checks
`operatorCanAccessProject` against the target resource's project and returns
`denied` / `forbidden` on a mismatch — a scoped operator cannot see or touch
another project's tasks, workflows, approvals, or audit events. This is the seam
where a future auth layer supplies `identity + roles + project scopes`; it is not
a full enterprise IAM.

## 7. Audit

Every command emits exactly one `control_command` audit event via the existing
`AuditLog` — including denied and rejected commands. The event's `data` carries
`command`, `outcome`, `errorKind`, `correlationId`, `actor`, `actorRole`,
`resourceId`, `reason`, and redacted `details`; `projectId` / `agentId` /
`taskId` are set on the event where applicable. `data` is passed through
`redact()` — secrets, keys, tokens, and authorization headers never reach the
audit log. Audit queries are bounded and cursor-paginated and can filter by
`type, agent, task, workflow, project, tool, actor, correlationId, outcome`, and
date range.

## 8. Correlation IDs

A control operation is traceable end to end:

```
CONTROL REQUEST → COMMAND → TASK / WORKFLOW → CORE OPERATION → AUDIT EVENT
```

Every command carries a correlation id. A caller (a future HTTP layer) may supply
one in `options.correlationId` — a non-empty string is used verbatim; otherwise
`createCorrelationId()` mints one with `core`'s deterministic `createId` (prefix
`corr_`). The id is written to the `control_command` audit event
(`data.correlationId`) and returned on `ControlCommandResult.correlationId`, and
audit queries can filter by it. Existing task / workflow / audit ids are
unchanged — this rides alongside them.

## 9. Error handling

Built on the existing `WorkforceError` hierarchy — no new root. The command
services do not throw for expected rejections; they return a
`ControlCommandResult` whose `errorKind` is one of:

| `errorKind`        | Meaning                                      | `WorkforceError` / future HTTP                            |
| ------------------ | -------------------------------------------- | --------------------------------------------------------- |
| `invalid_request`  | Input shape is wrong                         | `ValidationError` / 400                                   |
| `unauthorized`     | No / invalid principal                       | — / 401                                                   |
| `forbidden`        | Role or project scope forbids the action     | `PermissionDeniedError` / `ForbiddenError` / 403          |
| `not_found`        | The target resource does not exist           | `NotFoundError` / 404                                     |
| `invalid_state`    | Illegal transition / not retryable / cap hit | `StateTransitionError` / `InvalidControlStateError` / 409 |
| `approval_failure` | The approval subsystem faulted               | `ApprovalActionError` / 422                               |
| `command_failure`  | An unexpected core failure                   | `CommandFailedError` / 500                                |

`classifyErrorKind(error)` maps any thrown error to a kind. DTOs carry a plain
message only — **never** a stack trace.

## 10. Future API layer

The services are plain classes designed to be wrapped:

```
Web UI → HTTP/API → WorkforceQueryService  → Core
Web UI → HTTP/API → WorkforceCommandService → Permission / Approval / Core → Audit
```

No HTTP server is built in Phase 7A. `ControlEventPublisher` (`control/ports.ts`)
is the seam for real-time fan-out (SSE / WebSocket / Firestore listeners); a
successful command publishes a `command_result` event through it when one is
wired, and a publisher that throws never breaks the command.

## 11. Firebase boundary

**Firebase is not created, configured, or depended on in this phase.** No SDK, no
project, no Firestore rules, no Auth, no Hosting, no Cloud Functions.

Firebase can only ever be an **adapter behind a port**:

```
Control Plane → port interface → Firebase adapter → Firestore / Firebase Auth
```

| Port                                     | Firebase adapter target (Phase 7B)                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Repository<T>` (`ControlRepository<T>`) | A Firestore-backed repo for `AgentOperationalRecord`, `WorkflowControlRecord`, and the core collections. `Repository<T>` is **synchronous** (ADR-0002); a networked store needs an ADR-gated async revision — out of scope here. |
| `OperatorDirectory`                      | Resolve a Firebase ID token → `OperatorPrincipal`.                                                                                                                                                                               |
| `ControlEventPublisher`                  | Push `ControlPlaneEvent`s to Firestore / a realtime channel.                                                                                                                                                                     |

Both control-plane stores already accept an injected `Repository<T>`, so swapping
persistence needs no change to `control/`.

## 12. Security principles

- **Deny by default** — unknown roles and unlisted capabilities get nothing.
- **Server-side authorization** — enforced in the services, not the UI.
- **Permission precedence** — commands run through core; core's `PermissionSystem`
  and `ApprovalSystem` still decide. The Control Plane cannot widen a grant or
  skip an approval.
- **Project isolation** — every query and command is scoped to the operator's
  projects.
- **Secret redaction** — all operator-visible fields and all audit `data` pass
  through `redact()`; no credentials, keys, tokens, or authorization headers are
  exposed or logged.
- **Auditability** — every command (executed, denied, rejected) is a
  `control_command` event with a correlation id.
- **No unrestricted execution** — explicit operations only; no shell, no raw
  query, no arbitrary tool invocation, no generic admin method.
- **No stack traces in DTOs.**
