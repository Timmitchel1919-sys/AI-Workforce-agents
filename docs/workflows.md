# Multi-Agent Workflow Orchestration

A controlled way for several General Agents to collaborate on one high-level
task, without becoming an unrestricted autonomous swarm. A `Workflow` is a
declarative task graph; the `WorkflowEngine` schedules it strictly through the
existing `Orchestrator` — every task still passes permission checks, approval
gates, and (for tool-using agents) the `ToolExecutionEngine`.

## 1. Architecture

```
User task
   │
   ▼
WorkflowEngine.planFromObjective()  ──▶  Project Manager Agent (one task, via Orchestrator)
   │                                          │ produces a ProjectManagerDecision
   │◀─────────────────────────────────────────┘ (subtasks + recommended agents — never trusted blindly)
   ▼
WorkflowEngine.submit(WorkflowDraft)
   │  WorkflowSystem.create(): validate shape, unique ids, known deps, NO CYCLES
   ▼
WorkflowEngine.run() — scheduling loop
   │
   │  for each "ready" spec (all dependsOn completed):
   │    1. assignAgent()            — re-validate agent/project/capability/tool, never trust the spec blindly
   │    2. ensureHandoffs()         — propose + accept a Handoff across any cross-agent edge
   │    3. Orchestrator.submit()    — permission gate → approval gate → RoutingAgentExecutor → GeneralAgent
   │    4. applyTaskOutcome()       — completed / retry / failed+propagate-skip / awaiting_approval (pause)
   │
   ▼
Completed / Failed  ──▶  WorkflowResult  ──▶  (optionally) Project Manager Agent again, mode "summarize"
```

The engine never calls a model, a tool, or a credential itself. It only
decides _which_ ready task to dispatch next and _what happens_ to the graph
when a task completes, fails, needs approval, or hits a limit — every actual
execution goes through the `Orchestrator`, exactly as a single-task submission
would.

## 2. Workflow model

`WorkflowDraft` (`contracts/workflow.ts`): `name`, `description`, `projectId`
(the workflow is scoped to **one** project), `participatingAgents` (the only
agents any task may be assigned to), `tasks` (`WorkflowTaskSpecDraft[]`),
`successCriteria`, `failureBehavior` (`"abort"` default | `"continue"`),
`limits`, `retryPolicy`, `metadata`. Nothing here is research/dev/QA-specific
— task `type` is just a string a workflow author chooses to match
`Agent.supportedTaskTypes`.

`WorkflowSystem.create` (mirrors `TaskSystem`'s pattern) validates the draft,
rejects a graph that exceeds `limits.maxTasks`, and stores an immutable
`Workflow` with one `WorkflowTaskRecord` per spec, all `"pending"`.

## 3. Task dependency model

Each `WorkflowTaskSpec` declares `dependsOn: string[]` — spec ids that must
reach `"completed"` first. `findCycle` (pure, in `contracts/workflow.ts`) runs
a three-colour DFS over the graph at validation time:

- unknown dependency id → rejected, nothing created
- self-dependency → rejected
- any cycle (`A → B → C → A`) → rejected with the exact cycle path, nothing
  created and **no task runs**

At runtime, `computeReadySpecs` (`core/workflows/workflow-graph.ts`) returns
specs whose record is `"pending"` and whose every dependency record is
`"completed"`. When a task fails without a retry (or its assignment is
invalid), `propagateSkip` walks the graph and marks every transitive
dependent `"skipped"` — a blocked task never silently "starts anyway".

## 4. Project Manager Agent

`agents/project-manager/` — a `GeneralAgent<ProjectManagerTask,
ProjectManagerDecision>` with two modes on the same pipeline:

- `"decompose"` — one model call turns an objective into 2–6
  dependency-ordered `ProjectManagerSubtask`s (id, type, description, a
  recommended agent or capability, `dependsOn`, `acceptanceCriteria`, and
  optionally a structured `input` for the receiving agent's own contract).
- `"summarize"` — one model call turns `priorResults` (from a completed
  workflow's task records) into an overall summary and a `finalStatus`
  (`completed` | `blocked` | `failed`).

It **never** creates a task, assigns an agent, or touches a tool — it has no
such dependency injected, and its permission grants explicitly deny
`write`/`deploy`/`external_communication`/`secret_access` as defence in depth.
`WorkflowEngine.planFromObjective` is the only thing that turns a decision
into a real `Workflow`, and it does so through the same `assignAgent`
validation as a hand-authored workflow — a PM recommendation is a
_suggestion_, never trusted blindly.

## 5. Developer Agent

`agents/developer/` — planning/review-oriented in this phase. One model call
produces a `DeveloperResult`: a `plan` (strings), `proposedChanges`
(`description` + `rationale` + `riskLevel`), `risks`, `openQuestions`, and a
`recommendation` (`ready_for_qa` | `needs_clarification` | `blocked`). It has
**no filesystem, shell, or repository dependency to call** — every risky
permission is explicitly denied. Turning a proposed change into an applied
one is a distinct, approval-gated capability left for a later phase (see
Known limitations).

## 6. QA Agent

`agents/qa/` — evaluates a `QATask` (`objective`, `acceptanceCriteria`,
`artifacts` given directly as data — QA does not fetch anything itself) and
returns a `QAResult`: `verdict` (`pass` | `fail` | `blocked`), one `finding`
per criterion (`satisfied` + `evidence`), `defects`, and a `recommendation`.

**QA cannot approve its own work without evidence**, enforced twice:

1. Deterministically, in the agent: any acceptance criterion the model didn't
   address becomes an unsatisfied finding (`reconcileFindings`), and a
   claimed `"pass"` is downgraded to `"fail"` whenever any finding is
   unsatisfied (`enforceVerdict`).
2. Structurally, in `validateQAResult` (`contracts/qa.ts`): a `"pass"` verdict
   is **rejected outright** unless there is at least one finding and every
   finding is satisfied — even if step 1 were bypassed, the contract itself
   would not accept an unevidenced pass.

## 7. Agent assignment

`assignAgent` (`core/workflows/workflow-graph.ts`) is the single place a spec
turns into a real agent id, and it **never trusts a recommendation blindly** —
neither a hand-authored `agentId`/`capability` nor a PM-recommended one:

1. resolve a candidate (`spec.agentId`, or the first eligible agent with
   `spec.capability` among `participatingAgents`)
2. the agent must be **registered**
3. the agent must be a **declared participant** of this workflow
4. the agent must be **eligible** (`AgentRegistry.eligible`: supports the
   task's `type` _and_ is allowed on the workflow's `projectId`)
5. if a `capability` was requested, the agent must **actually hold it**
6. every `expectedTools` id must be **registered and authorized for this
   agent** in the `ToolRegistry` (when one is supplied)
7. every `requiredPermissions` entry is pre-evaluated (informational — the
   `Orchestrator` remains the real enforcement point at dispatch)

Any failure returns `{ validated: false, reason }` — the task never runs; its
record is marked `"blocked"`, dependents are skipped, and (in `"abort"` mode)
the workflow fails.

## 8. Handoffs

`WorkflowEngine.ensureHandoffs` uses the existing `HandoffSystem` — no new
handoff mechanism. For every dependency edge whose two tasks resolve to
**different** agents (and only when the successor's `acceptanceCriteria` is
non-empty, since `HandoffSystem` requires it), the engine:

1. `handoffs.propose(...)` — `completedWork` from the predecessor, `remainingWork`
   and `acceptanceCriteria` from the successor, `artifacts: [predecessorTaskId]`
2. `handoffs.accept(...)` — accepted immediately before the successor's task
   is dispatched, representing the receiving agent's explicit acceptance at
   the moment it begins consuming the work

Both are real, validated, structured `Handoff` records (queryable via
`handoffs.forTask`/`list`) — not free text. `counters.handoffs` is checked
against `limits.maxHandoffs`.

## 9. Context

Nothing new: each agent still reads only its own task's `ContextSystem`
scope, exactly as in Phase 3. A workflow is bound to one `projectId`, so every
task it creates shares that project — but agent context reads remain isolated
per `(project, agent)` and task context per `(project, task)`, and a workflow
for Money Mind can never see AIMS context, because `ContextSystem` itself
still enforces that (unchanged from Phase 1/3).

## 10. Workflow lifecycle

```
created ──▶ planned ──▶ running ──▶ completed
                            │
             ├─▶ awaiting_approval ─▶ running
             └─▶ blocked ─▶ running | failed
                            │
                            └─▶ failed | cancelled
```

Mirrors `TaskSystem`'s own transition-table pattern
(`WORKFLOW_STATUSES`, checked by `WorkflowSystem.canTransition`/`transition`).
`completed`, `failed`, `cancelled` are terminal. Per-task status
(`WorkflowTaskStatus`): `pending → ready(implicit) → dispatched(implicit) →
completed | failed | blocked | skipped | cancelled`, or `awaiting_approval`
while parked. "QA" is not a special workflow status — it is simply a task
whose `type === "qa"`; the engine emits extra `qa_passed`/`qa_failed`
`workflow_event`s when such a task completes, for observability.

## 11. Failure handling & retry policy

```
task fails
   │
   ▼
extractFailureReason(message)      — reads the "[agentId:reason]" prefix
   │                                  AgentExecutionError always produces
   ▼
shouldRetry(policy, reason, count) — retryable reason AND count < maxRetries?
   │
   ├─ yes ─▶ record → "pending" (re-attempted next scheduling pass), counters.retries++
   │
   └─ no  ─▶ record → "failed" → propagateSkip() marks transitive dependents "skipped"
                    → failureBehavior "abort"?  fail the whole workflow now
                                     "continue"? keep running independent branches
```

`RetryPolicy.retryableReasons` defaults to `tool_failure`, `tool_unavailable`,
`model_failure`, `model_unavailable`, `timeout` — **never**
`permission_denied`, `invalid_task`, `invalid_result`, or `limit_exceeded`.
`maxRetries` is a hard per-task ceiling; there is no unbounded retry loop.

## 12. Approval gates

Unchanged from Phase 2A, exercised per task exactly as a standalone
`orchestrator.submit` would: if the orchestrator's `ApprovalPolicy` requires
approval for a task, that task's record becomes `"awaiting_approval"` and the
**handler is never invoked**. If nothing else is actionable, the whole
workflow transitions to `"awaiting_approval"` and `run()`/`schedule()`
returns — dependents stay `"pending"`, never dispatched. A human decides via
`orchestrator.recordApprovalDecision(...)`; the caller then calls
`engine.resume(workflowId)`, which resumes every parked task
(`orchestrator.resume`) and continues scheduling. Calling `resume` on a
workflow that is not `"awaiting_approval"` throws — there is no way to skip
the gate.

## 13. Delegation limits

`WorkflowLimits.maxDelegationDepth` (default `1`) bounds how many nested
`planFromObjective` calls are allowed — checked before the Project Manager
even runs. The Project Manager itself runs **once** per `planFromObjective`
call and produces a decision, not further delegation; there is no mechanism
for an agent to invoke `planFromObjective` itself. Combined with
`maxTasks`, this is the whole "no unbounded agent/task creation" guarantee.

## 14. Execution limits

| Limit                | Meaning                                                                                                                        | Enforced                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `maxTasks`           | total specs in the graph                                                                                                       | at `WorkflowSystem.create` — rejected outright, nothing runs |
| `maxAgentExecutions` | total `Orchestrator.submit`/`resume` calls                                                                                     | before each dispatch in the scheduling loop                  |
| `maxRetries`         | retries per task (via `RetryPolicy`)                                                                                           | in `applyTaskOutcome`                                        |
| `maxHandoffs`        | total accepted handoffs                                                                                                        | after `ensureHandoffs`                                       |
| `maxToolCalls`       | aggregate tool calls (summed from each completed task's `output.metadata.counters.toolCalls`, when a General Agent reports it) | after each dispatch                                          |
| `maxDurationMs`      | wall-clock since the workflow started running (injectable clock)                                                               | at the top of every scheduling pass                          |
| `maxDelegationDepth` | nested `planFromObjective` calls                                                                                               | before running the Project Manager                           |

Any breach stops the workflow, transitions it to `"failed"` with a
descriptive `error`, and records a `workflow_event` — never a silent
continuation. A generous, finite pass-count ceiling in `schedule()` is an
additional belt-and-braces guard against a scheduling logic error, independent
of `maxDurationMs`.

## 15. Security model

- **Deny-by-default / least privilege**: unchanged `PermissionSystem`
  semantics; the Project Manager, Developer, and QA agents hold only explicit
  `deny` grants for risky actions and no tool access at all in this phase.
- **Explicit project/agent/tool/environment scope**: `assignAgent` checks all
  four before a task is ever created; `ToolExecutionEngine` (used by the
  Research Agent inside a workflow) enforces the same at the tool level.
- **Approval gates**: unbypassable — see §12.
- **Auditability**: every workflow-level decision is a `workflow_event`; see §16.
- **No unrestricted shell/filesystem/network/secret access**: the three new
  agents have no such dependency to call; a source-scan test asserts the
  Developer Agent's files contain no `node:fs`/`node:child_process` reference.
- **No autonomous deployment**: nothing in this phase can deploy; a future
  deployment tool would need `approvalPolicy: { always: true }` at minimum.

## 16. Audit model

One new audit event type, `workflow_event`, with a `data.kind` discriminator
— the same "don't grow the enum per component" approach as `agent_activity`
(ADR-0005) and `tool_execution` (ADR-0006). Kinds emitted:
`workflow_created`, `workflow_validated`, `workflow_started`, `agent_assigned`,
`task_created`, `task_started`, `handoff_created`, `handoff_accepted`,
`task_completed`, `task_failed`, `task_blocked`, `retry_requested`,
`approval_requested`, `qa_passed`, `qa_failed`, `workflow_completed`,
`workflow_failed`. Approval _decisions_ reuse the existing
`approval_decided` event (recorded by the `Orchestrator`/`ApprovalSystem`
exactly as before). Nothing here ever logs a secret; tool output was already
excluded from the audit log by the Tool & Execution Framework (Phase 4) and
that is unchanged.

## 17. General Agent reusability

Every agent in this phase — Research (Phase 3), Project Manager, Developer,
QA — follows the identical pattern:

```
Agent Definition (make<Agent>Definition)
      ↓
Agent Contract (contracts/<agent>.ts: Task + Result + validators)
      ↓
Agent Executor (extends GeneralAgent<TInput, TOutput>)
      ↓
Context (ContextSystem, when the agent needs project/task state)
      ↓
ModelProvider (one or more calls; provider-neutral)
      ↓
ToolExecutionEngine (only when the agent needs tools — Research does; PM/Dev/QA don't yet)
      ↓
Structured Result (validated before returning)
      ↓
Handoff (when a workflow hands its output to a different agent)
      ↓
Audit (agent_activity + workflow_event, automatically)
```

A future agent (Data Analyst, Security, Finance, Business, Design,
Documentation) is: a contract file, a `GeneralAgent` subclass, a definition
file with least-privilege grants, and tests — no framework change.

## 18. End-to-end example

```ts
const workflow = await engine.planFromObjective({
  name: "Add API rate limiting",
  description: "Research, plan, and verify rate limiting for the widgets API",
  projectId: "widgets-service",
  participatingAgents: [RESEARCH_AGENT_ID, DEVELOPER_AGENT_ID, QA_AGENT_ID],
  objective: "Add rate limiting to the widgets API",
  availableAgents: [RESEARCH_AGENT_ID, DEVELOPER_AGENT_ID, QA_AGENT_ID],
});
// User
//   ↓
// Project Manager (decompose)      → 3 subtasks, dependency-ordered
//   ↓
// Research         (via Orchestrator, permission-checked, tool calls via ToolExecutionEngine)
//   ↓ handoff (accepted)
// Developer         (proposes a plan — never applies it)
//   ↓ handoff (accepted)
// QA                (pass/fail/blocked, self-approval structurally impossible without evidence)
//   ↓
// workflow.status === "completed"; workflow.result is a WorkflowResult

// Project Manager again, to close the loop:
const summary = await orchestrator.submit({
  type: "project-manager-plan",
  projectId: "widgets-service",
  description: "Summarize the completed workflow",
  input: { mode: "summarize", objective: "...", priorResults: [...] },
});
// summary.output.finalStatus === "completed"
```

See `tests/workflow-demo.test.ts` for the full, deterministic, offline version
of this — no real Anthropic API, web service, or repository is touched.

## 19. Known limitations

- A predecessor's real output is **not** automatically substituted into a
  successor's declared `input` — the Project Manager may supply a static
  `input` per subtask at decompose time, but there is no dynamic
  "task B receives task A's output" wiring yet. The demo works around this by
  giving QA a static artifact rather than the Developer's live output.
- `maxToolCalls` is only as accurate as each General Agent choosing to report
  `output.metadata.counters.toolCalls` (Research does; a future agent must
  opt in the same way).
- The Project Manager is invoked at most once per `planFromObjective` call;
  there is no automatic "PM re-plans after a mid-workflow failure" loop — a
  failure surfaces as a normal `workflow_failed`/`task_blocked` audit trail
  for a human or a subsequent, separate `planFromObjective`/task to react to.
- The Developer Agent cannot apply a change — only propose one. A real "apply
  this diff" capability needs its own approval-gated tool in a later phase.
- `WorkflowEngine.schedule` is a single in-process loop — there is no
  persistence of an in-flight scheduling pass across a process restart (the
  `Workflow`/`WorkflowTaskRecord` state itself can be persisted via a
  `Repository<Workflow>`, same as any other core system, but a restart mid-loop
  would need `run()` called again, which is safe and idempotent given the
  stored state).
