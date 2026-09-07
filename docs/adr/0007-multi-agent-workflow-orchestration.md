# ADR-0007: Multi-agent workflow orchestration

**Status:** Accepted
**Date:** 2026-09-07
**Related:** [ADR-0005](0005-general-agent-pattern.md),
[ADR-0006](0006-tool-execution-framework.md)

## Context

Phase 5 needs several specialized agents (Project Manager, Developer, QA, on
top of Research) to collaborate on one high-level task through a controlled,
auditable pipeline — not an unrestricted autonomous swarm. The existing
`Orchestrator` dispatches exactly one task at a time; nothing yet models a
dependency graph, cross-agent handoff sequencing, or a "plan then execute"
step.

## Decisions

### 1. A `WorkflowEngine` composes the `Orchestrator`; it does not replace it

`core/workflows/workflow-engine.ts` holds an `Orchestrator` instance and calls
`submit`/`resume` per task. Every enforcement Phase 2A–4 built — permission
gate, approval gate, `RoutingAgentExecutor`, `ToolExecutionEngine` — applies to
a workflow task exactly as it would to a standalone one, with zero changes to
`Orchestrator` itself. `WorkflowSystem` (task-graph state) and
`workflow-graph.ts` (pure scheduling/assignment helpers) are separate files —
"keep responsibilities modular," not one giant class.

### 2. The task graph is an array with `dependsOn`, validated by cycle detection before anything is created

No graph database, no new dependency. `findCycle` is a ~30-line three-colour
DFS over `{id, dependsOn}[]`, pure and contract-level (`contracts/workflow.ts`)
so both a hand-authored `WorkflowDraft` and a Project-Manager-produced
decision (`contracts/project-manager.ts`) can validate against it. A cyclic or
otherwise malformed graph is rejected by `WorkflowSystem.create` — nothing is
stored, nothing runs.

### 3. Agent assignment is always re-validated, never trusted

`assignAgent` (`workflow-graph.ts`) is the single choke point a spec's
`agentId`/`capability` — whether hand-authored or Project-Manager-recommended
— must pass: registered, a declared workflow participant, eligible
(`AgentRegistry.eligible`), holds the requested capability, and (when
declared) authorized for its `expectedTools`. A failed check blocks the task
and never reaches the `Orchestrator`.

### 4. Project Manager, Developer, and QA follow the identical `GeneralAgent` pattern as Research

Same shape as ADR-0005 mandates: definition + contract + `GeneralAgent`
subclass + least-privilege grants + tests. None of the three has tool access
in this phase — Project Manager and Developer only reason over what they're
given; QA only evaluates supplied artifacts. This keeps the security surface
minimal while the pattern itself scales to the next six agents without
redesign.

### 5. QA's "no self-approval" guarantee is structural, not just behavioural

`validateQAResult` rejects a `"pass"` verdict unless every finding is
satisfied and at least one exists — a contract-level invariant, independent of
whatever the QA Agent's own logic does. The agent additionally reconciles
missing findings and downgrades an inconsistent claimed pass
(defence in depth), but even if that logic were removed or a future agent's
version differed, the contract itself cannot be talked into an unevidenced
pass.

### 6. Handoffs are real `HandoffSystem` records, propose-then-accept, only across agent boundaries

The engine proposes a handoff when a dependency edge crosses from one agent to
a different one, and accepts it immediately before the successor's task
dispatches — modelling "the receiving agent explicitly accepts the work" at
the moment it begins. Same-agent edges (a chain of tasks assigned to one
agent) create no handoff — nothing to hand off.

### 7. One new audit type, `workflow_event`, with a `data.kind` discriminator

Consistent with `agent_activity` (ADR-0005) and `tool_execution` (ADR-0006):
growing `AuditEventType` per workflow phase (workflow created, started, task
blocked, retry requested, ...) would bloat the enum for every future agent
combination. Approval decisions still reuse the existing `approval_decided`
event unchanged.

### 8. Retry policy reads the failure reason out of `AgentExecutionError`'s message convention

`AgentExecutionError` already formats as `[agentId:reason] message`
(established in ADR-0005). `extractFailureReason` parses that instead of
introducing a second channel for the reason. This is a documented coupling to
an existing convention, not a new contract — see Known Limitations in
docs/workflows.md if that convention ever changes.

### 9. Delegation is bounded structurally, not by convention

`WorkflowLimits.maxDelegationDepth` (default 1) is checked in
`planFromObjective` _before_ the Project Manager runs, and nothing in the
codebase lets an agent call `planFromObjective` itself — only application code
holding a `WorkflowEngine` reference can. Combined with `maxTasks` (rejected
at creation) and `maxAgentExecutions`/`maxToolCalls`/`maxHandoffs`/
`maxDurationMs` (checked every scheduling pass), there is no path to unbounded
agent or task creation.

## Options considered

| Concern               | Chosen                                         | Rejected                                                                                     |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Task graph            | flat array + `dependsOn` + DFS cycle check     | a graph library / database (over-engineered for ≤`maxTasks` nodes)                           |
| Scheduling            | synchronous loop over `Orchestrator.submit`    | a queue/worker system (async infra not yet justified — see ADR-0001)                         |
| Agent trust           | re-validate every assignment via `assignAgent` | trusting the Project Manager's recommendation directly (explicitly forbidden by the brief)   |
| PM/Dev/QA tool access | none in this phase                             | giving Developer a "propose a diff" tool now (adds surface before there's a consumer for it) |
| Audit                 | one `workflow_event` type + `kind`             | a literal event type per lifecycle transition                                                |

## Consequences

- A workflow inherits every Phase 2A–4 control for free; no security review
  gap between "a task" and "a task inside a workflow."
- Nine more agents (Data Analyst, Security, Finance, Business, Design,
  Documentation) plug in via the same five-file pattern.
- No dynamic "task B receives task A's live output" wiring yet — a Project
  Manager subtask's `input` is static at decompose time. A later phase can add
  templated/derived inputs without changing the graph or assignment model.
- The Developer Agent cannot apply a change; that is a deliberate gap, closed
  by a future approval-gated "apply" tool, not by this phase.
- `extractFailureReason`'s regex coupling to `AgentExecutionError`'s message
  format is a known, documented fragility — changing that format elsewhere
  must update this parser too (a test would then fail loudly, not silently).
