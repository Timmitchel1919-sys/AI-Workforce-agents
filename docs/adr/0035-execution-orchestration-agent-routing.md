# ADR-0035: Execution Orchestration & Agent Routing (Layer 4)

## Status

Accepted (Layer 4)

## Context

Layer 3 produces a validated `PreparedExecutionRequest`. Layer 4 turns it into
an executable, governed work plan: decompose, order, route to a qualified
agent and model, authorize tools, gate on review and human approval, verify,
recover from failure. The platform is a private, single-user system: no
tenants, organizations or enterprise administration are introduced.

## What already existed (reused, not rebuilt)

`TaskSystem`, `Orchestrator` (single-task dispatch), `SoftwareFactoryOrchestrator`
(programs/workstreams), `SpecialistAssignmentService` + `AgentQualificationRouter`
(descriptor-level qualification, leases), `ModelRouter` (EO-7, governance- and
budget-aware), `BudgetEnforcer`/`UsageLedger` (AI Cost Center), `RuleAuditor`,
`ApprovalSystem`, `AuditLog`, the capability taxonomy, the domain event bus and
the Layer 3 services. Layer 4 **composes** these through ports; it adds the
missing pieces only.

## Decision

```
PromptRequestView ─► decomposer ─► dependency engine ─► run (workflow)
run + advance ─► Agent Router ─► tool authorization ─► Model Router (port)
  ─► cost preflight ─► approval gate ─► resource lock ─► runtime (port)
  ─► CLAIMED result ─► verification ─► gates ─► next tasks / completion
```

- **Execution request**: `OrchestrationRequest` *references* the Layer 3 record
  (`prompt_requests/{id}`, prompt version) instead of copying context.
- **Task lifecycle**: `PENDING → READY → QUEUED → RUNNING → REVIEW → COMPLETED`
  (+ `BLOCKED`, `WAITING_APPROVAL`, `FAILED`, `RETRYING`, `CANCELLED`) as a closed
  transition table; `RUNNING → COMPLETED` is illegal — success must pass `REVIEW`.
- **Decomposer**: generates the smallest plan the request needs and records why
  standard tasks were omitted (no repo → no commit, no deploy target → no
  deploy, low risk → no security gate). Code-changing plans always route through
  test and **independent** review; destructive work is isolated in its own
  approval-gated task.
- **Dependency engine**: cycles, unknown references and skipped mandatory gates
  are rejected structurally; ready/parallel sets exclude tasks that write the
  same resource.
- **Agent Router** (single policy point): enabled, project-authorized, covers
  every required capability (broad covers narrow, never the reverse), tool/risk
  fit, not excluded; ranked by specialization then workload; the evidence and
  every rejection reason are recorded. A read-only agent never gets a task that
  needs write tools. The reviewer is never the implementer.
- **Model selection**: the task shape yields a model *need*; the existing
  `ModelRouter` answers through `ModelRouterAdapter`. No router/model →
  "no model" with a reason — never a fabricated model.
- **Cost**: `CostGate` preflight (BudgetEnforcer) blocks a task before it runs;
  token estimates are always shown, dollars only when the ledger priced them.
- **Tool authorization**: least-privilege allow-list per task type; gated tools
  (`git.commit`, `deploy.firebase`, `repo.delete`) only after THAT task's human
  approval; delete tools additionally require a destructive classification;
  secrets/policy/audit tools are never granted.
- **Approvals**: destructive tasks ask up front (visible `WAITING_APPROVAL`);
  commit/deploy ask when reached. Approval state is read from the live
  `ApprovalSystem`; denial cancels the task and its dependents. Approvals are
  stamped with the project id so existing scoping applies.
- **Verification**: an agent's report is a *claim*. It becomes `COMPLETED` only
  if the verifier accepts it (evidence, passing checks, review verdict).
- **Failure policy**: TRANSIENT → bounded retry with backoff, then reassign to
  another qualified agent, then escalate; LOGICAL gate failure → correction task
  and **re-run of every gate guarding the changed code** (completed gates are
  cloned, never reopened); SECURITY → blocked, never auto-retried (and not
  hand-retryable); bounded everywhere.
- **Locks**: all-or-nothing over sorted keys (no deadlock) with TTL expiry.
- **Status** is derived from tasks, never stored separately.
- **Audit**: `workflow_event` records with `data.event` ∈ EXECUTION_CREATED,
  PLAN_CREATED, TASK_CREATED, AGENT_SELECTED, MODEL_SELECTED, TOOL_AUTHORIZED,
  TASK_STARTED, TASK_COMPLETED, TASK_FAILED, TASK_RETRIED, TASK_BLOCKED,
  APPROVAL_REQUESTED/GRANTED/DENIED, WORKFLOW_COMPLETED …; text is scrubbed of
  secrets.

## Security properties

`orchestrate_execution` capability (operator, admin); reads need `view` plus
project access; a foreign run is indistinguishable from a missing one; frontend
state is never authority.

## Known gaps (reported, not hidden)

- **No execution runtime is wired in production**: `TaskRuntimePort` defaults to
  an "unavailable" runtime, so a task that would run is reported BLOCKED. The
  port is the seam for local/cloud/Docker/IDE runners (Phase 5).
- Production registers no software-development agents, so real plans block at
  routing ("no qualified agent") until specialists are staffed. Descriptor-level
  qualification (`AgentQualificationRouter`) is not yet consulted.
- The run lock manager is in-process; runs are persisted but cross-instance
  concurrency relies on per-run serialization within an instance.
- The Live Development Workspace is not connected (no workspace seam for runs).
- Runs advance on explicit commands (no background scheduler).
- Auditor integration is event-level (events for the rule-based auditor to
  inspect); no new audit rules were added.
