# Workforce Control & Operations Layer

The operational control plane. A human operator understands and controls agents,
tasks, workflows, projects, approvals, tool executions, failures, audit events,
and system health — **without** the control plane becoming the orchestration
engine.

```
CONTROL PLANE
      │
 ┌────┼────┐
 ▼    ▼    ▼
QUERY COMMAND EVENT
 │     │
 └─────┼─────┘
       ▼
      CORE
       │
   SECURITY
       │
     AUDIT
```

Strict layering: **UI → control services → core → contracts**. The control
plane never touches a database, a filesystem, a shell, or a credential; it reads
through core services and acts through them.

## 1. Architecture

| Layer                               | What it is                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `contracts/control.ts`              | Operator roles + capabilities, command result types, operational statuses, all query view types.                            |
| `control/`                          | `ControlPlaneContext` (injection bundle), operational stores, redaction, risk classification, health, pure view derivation. |
| `control/services/`                 | `WorkforceQueryService` (read), `WorkforceCommandService` (write).                                                          |
| `control/dashboard/`                | Pure HTML render + `buildDashboardHtml` (no framework, no deps, no shipped server).                                         |
| `core/registry/project-registry.ts` | `ProjectRegistry` — projects are selected by id, never hard-coded.                                                          |
| `core` change                       | `OrchestratorOptions.agentGate` — one optional injected predicate so a disabled agent cannot receive new tasks.             |

Nothing else in `core` changed. Phase 5 (`WorkflowSystem` / `WorkflowEngine`)
and Phase 6 (Money Mind adapter, read-only + path-contained) are used as-is.

## 2. Workforce status

`getWorkforceStatus(principal)` → `WorkforceStatus`: overall health,
`generatedAt`, and `counts` (active workflows, queued / running / blocked /
awaiting-approval / failed / completed / cancelled tasks, registered &
disabled agents, available tools, registered projects) plus `recentActivity`
(real, redacted audit events). Counts are project-scoped to the operator.

## 3. Agent monitoring

`getAgents` / `getAgent` → `AgentView`: id, name, role (from
`agent.metadata.role`), capabilities, **status**, `enabled` + `disabledReason`,
`currentTaskId` / `currentProjectId`, `allowedProjects`, `lastActivityAt`, and
`stats` (task count, completed, failed, cancelled, success rate).

Status is **derived from actually-tracked state**, not invented:

| Status      | Condition                           |
| ----------- | ----------------------------------- |
| `disabled`  | operator disabled the agent         |
| `idle`      | never assigned a task               |
| `busy`      | has a `running` task                |
| `waiting`   | has an `awaiting_approval` task     |
| `blocked`   | has a `blocked` task                |
| `failed`    | its most recent task ended `failed` |
| `available` | otherwise                           |

The only new state model is `AgentOperationalStore` — an enabled/disabled flag
per agent. The `AgentRegistry` definition is never mutated.

## 4. Task monitoring

`getTasks(principal, query)` → `PageResult<TaskView>`. Filters: `taskId`,
`workflowId`, `projectId`, `agentId`, `status`, `priority`, `since` / `until`
(updatedAt), `failedOnly`. Paginated (`limit`, opaque `cursor`, `nextCursor`).
`TaskView`: type, description, project, status, priority, assigned agent,
`workflowId` / `workflowSpecId`, `dependsOn`, `retryCount`, `failureReason`
(machine reason), redacted `lastError`, `approvalId` / `approvalState`,
timestamps. **Full task input/output/context are never returned** — `getTask`
adds only `redactedInputKeys` (non-sensitive top-level key names).

## 5. Workflow monitoring

`getWorkflows` / `getWorkflow` → `WorkflowView`: name, project, status,
`paused`, `progress` (`completed` / `total` / `failed` / `blocked` +
`fraction`), `currentSpecId`, `pendingApprovals`, `participatingAgents`,
`stages[]` (one per task spec, with real record status + redacted error), and
timestamps. **Progress is `completedTaskRecords / totalTaskRecords`** — a real
count, never a fake percentage.

## 6. Approval Center

`getApprovals(principal, { status? })` → `ApprovalView[]`: action, **risk**
(`low` / `medium` / `high`, classified deterministically from the action
string — `write` / `deploy` / `external_communication` / `secret_access` / … →
`high`), requester, reason, linked `taskId` / `workflowId` / `toolId` /
`agentId` / `projectId`, request + expiry + decision timestamps.

`command.approve(principal, { approvalId, note? })` and
`command.reject(principal, { approvalId, reason })` **go through
`ApprovalSystem`** (via `Orchestrator.recordApprovalDecision` when the approval
is task-linked) and then best-effort enact the follow-up (`Orchestrator.resume`
/ `WorkflowEngine.resume`). The UI never mutates approval state.

## 7. Human-in-the-loop commands

Every command runs the same pipeline:

1. **validate input** (shape) → invalid → `rejected`
2. **validate authorization** (role capability + project scope) → `denied`
3. **validate current state** (resource exists, valid state) → `rejected`
4. **execute through the core service**
5. **create a `control_command` audit event** — always, including `denied` /
   `rejected`
6. **return a `ControlCommandResult`** (`{ command, outcome, ok, reason,
resourceId, details, auditEventId, timestamp }`)

| Command                            | Core path                                          | Notes                                                                                                                         |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `approve` / `reject`               | `ApprovalSystem` (+ orchestrator/workflow resume)  | reason required to reject                                                                                                     |
| `cancelTask`                       | `TaskSystem.transition(…, "cancelled")`            | rejected if terminal                                                                                                          |
| `retryTask`                        | `TaskSystem.transition(…, "queued")`               | failed-only; non-retryable reasons rejected; workflow tasks rejected (retry via the workflow); operator retry cap (default 3) |
| `pauseWorkflow` / `resumeWorkflow` | `WorkflowControlStore` (+ `WorkflowEngine.resume`) | see §9                                                                                                                        |
| `cancelWorkflow`                   | `WorkflowSystem.transition(…, "cancelled")`        | rejected if terminal                                                                                                          |
| `disableAgent` / `enableAgent`     | `AgentOperationalStore`                            | **admin only**                                                                                                                |

## 8. Agent enable / disable

`disableAgent` (admin) sets the `AgentOperationalStore` flag and audits. A
disabled agent:

- **cannot receive new tasks** — the orchestrator's injected `agentGate`
  blocks dispatch (`task_assigned { assigned: false, reason: "agent_disabled" }`,
  task → `blocked`);
- **cannot initiate new tool requests** — transitively, because it gets no task
  to run;
- **cannot join new workflows** — workflow dispatch goes through the same
  orchestrator gate.

**In-flight work is left to finish** — the control plane never terminates a
running task or an external process. `enableAgent` restores dispatch.

## 9. Workflow pause / resume

Phase 5 workflows run synchronously to a terminal state or to
`awaiting_approval`; there is no long-lived dispatch loop to interrupt. So
pause/resume is a **control-plane guard**, not forced interruption:

- `pauseWorkflow` — valid only for a non-terminal workflow; records a
  `WorkflowControlRecord` (`paused: true`, by, reason, timestamp) and an audit
  event. **Workflow state is untouched.** Operationally: do not `run` / `resume`
  a paused workflow.
- `resumeWorkflow` — clears the pause flag; if the workflow is
  `awaiting_approval` and a `WorkflowEngine` is wired, calls
  `WorkflowEngine.resume`. Rejected if there is nothing to resume (not paused,
  not awaiting).

No workflow state is ever lost.

## 10. Task retry

`retryTask` checks, in order: task exists & operator authorized → task is
`failed` → the task is **not** part of a workflow → the last failure reason is
in `DEFAULT_RETRY_POLICY.retryableReasons` → the operator retry count
(`metadata.controlRetryCount`) is below the cap. Only then does it
`transition(…, "queued")` and bump the counter. The operator cannot create
infinite retries.

## 11. Audit Center

`getAuditEvents(principal, query)` → `PageResult<AuditEventView>`. Filters:
`type`, `agentId`, `projectId`, `taskId`, `workflowId`, `toolId`, `outcome`,
`since` / `until`. Paginated. `AuditEventView`: timestamp, type, best-effort
`actor` / `outcome`, correlation ids (`taskId` / `agentId` / `projectId` /
`workflowId` / `toolId`), and **redacted, bounded** `data`. Full task context is
never dumped; any secret-looking key or value is `[redacted]`.

## 12. Project monitoring

`getProjects` / `getProject` iterate the **`ProjectRegistry`** — Money Mind is
just the first registration, never hard-coded. `ProjectView`: id, display name,
`status`, `adapterStatus` (from `adapter.describe()` — `unavailable` if it
throws), capabilities, connected agents, active workflows, recent task ids,
recent activity. AIMS / Mastery / Tripod plug in by registering their adapter.

## 13. Tool monitoring

`getTools` / `getTool` → `ToolView`: id, name, version, capabilities, allowed
agents / projects / environments, required permission, `approvalRequired`, and
`stats` (total / completed / failed / denied / timed-out / approval-required,
counted from `tool_execution` audit events). **Never** exposes credentials, API
keys, secret env vars, or authorization headers — the `Tool` contract has none,
and the view copies only policy metadata.

## 14. System health

`getHealth(principal)` → `SystemHealth` with per-component status
(`healthy` / `degraded` / `unavailable`). Only what is measurable in-process is
checked: `application`, `persistence` (readable?), `audit`, `tool-registry`,
`projects` (any registered?). Anything not wired to a real probe —
notably `model-provider` — is reported `degraded` with an explicit "not
checked" note. **The control plane never claims an unchecked external provider
is healthy.** Pass real probes via `ControlPlaneContext.healthProbes`.

## 15. Query & command services

`WorkforceQueryService`: `getWorkforceStatus`, `getAgents`, `getAgent`,
`getTasks`, `getTask`, `getWorkflows`, `getWorkflow`, `getApprovals`,
`getAuditEvents`, `getProjects`, `getProject`, `getTools`, `getTool`,
`getHealth`, `getDashboardSnapshot`. All read-only, all `view`-gated, all
project-scoped.

`WorkforceCommandService`: `approve`, `reject`, `cancelTask`, `retryTask`,
`pauseWorkflow`, `resumeWorkflow`, `cancelWorkflow`, `disableAgent`,
`enableAgent`. All return `ControlCommandResult`; all emit `control_command`.

## 16. Security

- **Authentication is not the control plane's job** — the HTTP layer
  authenticates and hands the services a trusted `OperatorPrincipal`. The
  services enforce **authorization** from it.
- **Deny-by-default** capability model; **project isolation** on every query and
  command; **secret redaction** everywhere; every command **audited**.
- The UI is **not** a security boundary — a hostile client hitting the command
  endpoint directly is still bound by role + project checks.

## 17. Operator roles

| Role       | Capabilities                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `viewer`   | `view`                                                                                                           |
| `operator` | `view`, `approve`, `reject`, `cancel_task`, `retry_task`, `pause_workflow`, `resume_workflow`, `cancel_workflow` |
| `admin`    | operator + `disable_agent`, `enable_agent`                                                                       |

`operatorCan(principal, capability)` — unknown role → no capabilities.
`operatorCanAccessProject(principal, projectId)` — `allowedProjects: "*"` or an
explicit allow-list.

## 18–23. UI

An internal operations console, not a website. `buildDashboardHtml(snapshot,
{ commandEndpoint })` returns **one self-contained HTML document** — no
framework, no external asset, no build step. Nine sections: Overview, Agents,
Workflows, Tasks, Approvals, Projects, Tools, Audit, Health. Tab switching is
inline JS toggling `hidden`. Approve / Reject buttons POST `{ command,
approvalId, reason }` to the configured endpoint; high-risk approvals require a
confirm. Empty states, an error banner (`snapshot.error`), and full HTML
escaping are covered by tests. Data always comes from the query service — no
fake data. Serving details: [`control/dashboard/README.md`](../control/dashboard/README.md).

## 24. Real-time

Deliberately **not** implemented. The model is request/response
(`getDashboardSnapshot`). A future event bus (`Core Event → Event Bus → Control
Plane → UI`) would be designed as an explicit subscription boundary first.

## 25–26. Persistence & observability

Every store uses the existing `Repository<T>` (in-memory default). Control-plane
queries go through core services, never implementation storage. Every audit
event and command result carries correlation ids so
`operator action → command → task/workflow → agent → tool → audit` is traceable.

## 32. Architectural constraints (upheld)

`core → contracts`, `adapters → contracts`, `control → core/contracts`,
`UI → control services`. Never `UI → database / filesystem / shell /
credentials`, never `agent → UI`.
