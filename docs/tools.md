# Tool & Execution Framework

One secure, standardised pipeline through which **any** agent requests and runs
a tool. An agent never invokes a tool, a `ToolProvider`, the permission system,
or a credential directly — it builds a `ToolExecutionRequest` and hands it to
the `ToolExecutionEngine`.

## 1. Architecture

```
Agent
  │  createRequest(draft)
  ▼
ToolExecutionRequest ──▶ ToolExecutionEngine.execute()
                            │
                            ├─ validate request            → failure(invalid_request)
                            ├─ resolve tool (ToolRegistry)  → failure(unknown_tool)
                            ├─ agent / project / environment eligibility  → denied(...)
                            ├─ input size + per-task/agent call limits     → failure(*_too_large | call_limit_exceeded)
                            ├─ PermissionSystem.evaluate + audit           → denied(permission_denied)
                            ├─ approval policy?  ── yes ─▶ ApprovalSystem.request → approval_required  (STOP)
                            │                                                        │  human decides
                            │                              resume(requestId) ◀───────┘
                            ├─ execute handler (with timeout)              → failure(tool_error) | timeout
                            ├─ output size + output schema                 → failure(output_too_large | malformed_result)
                            └─ audit completed
                            ▼
                      ToolExecutionResult ──▶ Agent
```

Every step records a `tool_execution` audit event (`data.phase`), plus
`permission_decision`, `approval_requested`, and `approval_decided` where
relevant. The engine is **deterministic**: no randomness, an injectable clock,
no wall-clock branching on the happy path.

## 2. Tool contract (`ToolDefinition` / `Tool`)

| Field                                  | Meaning                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`, `name`, `description`, `version` | Identity (all non-blank).                                                          |
| `capabilities`                         | Non-empty list, searchable via `ToolRegistry.byCapability`.                        |
| `requiredPermission.action`            | The single `PermissionAction` a caller must hold.                                  |
| `approvalPolicy?`                      | `{ always? , environments? , actions? , reason? }`. Absent = never approval-gated. |
| `allowedAgents`                        | Agent ids allowed to call it. `["*"]` = any. **Empty = none** (deny-by-default).   |
| `allowedProjects`                      | Project ids it may run for. `["*"]` = any. Empty = none.                           |
| `allowedEnvironments`                  | Non-empty subset of `local` / `test` / `staging` / `production`.                   |
| `timeoutMs`                            | Per-call wall-clock ceiling.                                                       |
| `limits`                               | `ToolExecutionLimits` (see §7).                                                    |
| `inputSchema?`, `outputSchema?`        | `(value) => void` validators that throw on mismatch.                               |
| `metadata`                             | Free-form.                                                                         |

`Tool = ToolDefinition & { execute(input, ctx: ToolExecutionContext) }`.
`validateToolDefinition` rejects anything malformed on registration.

`ToolExecutionContext` (what the handler receives): `requestId`, `taskId`,
`agentId`, `projectId`, `environment`, `deadlineMs`. **No permission system, no
credentials, no filesystem, no shell.**

## 3. Tool Registry

`ToolRegistry` (`core/tools/tool-registry.ts`):

- `register(tool)` — validates, **freezes** the definition (`Object.freeze`,
  nested), rejects duplicates, emits `tool_registered`.
- `update(id, changes)` — the **only** sanctioned way to change a definition;
  re-validates and swaps.
- `get` / `require` / `has` / `list` / `byCapability`.
- `eligibleForAgent(id, agentId)` / `eligibleForProject(id, projectId)`.
- `describe(id)` — public metadata **without** the handler or schema functions.

Frozen definitions cannot be mutated in place — an attempt throws `TypeError`.

## 4. Tool Request (`ToolExecutionRequest`)

`{ requestId, taskId, agentId, projectId, toolId, action, input, environment,
requestedAt, metadata }`. Build it with `engine.createRequest(draft)` — the
engine fills `requestId`, `requestedAt`, defaults `action` from the tool's
`requiredPermission`, `input` to `null`, `environment` to `local`.
`validateToolExecutionRequest` runs first in `execute` — a bad request is a
structured `failure(invalid_request)` and no tool runs.

## 5. Tool Result (`ToolExecutionResult`, aliased `ToolResult`)

`{ requestId, toolId, taskId, status, output?, error?, approvalId?, durationMs,
timestamp, metadata }`.

| `status`            | When                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `success`           | Handler returned; output within size + schema. `output` set.                                                        |
| `failure`           | Bad request, unknown tool, limit exceeded, malformed result, or the handler threw. `error.reason` gives the detail. |
| `timeout`           | Handler exceeded the effective timeout. `output` discarded.                                                         |
| `denied`            | Agent / project / environment not allowed, permission denied, or approval rejected/expired.                         |
| `approval_required` | A gated tool is parked; `approvalId` set; call `engine.resume(requestId)` after a decision.                         |

`error.reason` ∈ `invalid_request`, `unknown_tool`, `agent_not_allowed`,
`project_not_allowed`, `environment_not_allowed`, `permission_denied`,
`approval_rejected`, `approval_expired`, `input_too_large`, `output_too_large`,
`call_limit_exceeded`, `tool_error`, `timeout`, `malformed_result`,
`internal_error`. `error.message` is the tool's own message — **tool authors
must not embed secrets in it**; `error.details` never carries credentials, and
tool output is never written to the audit log.

## 6. Permission flow

The engine calls `PermissionSystem.evaluate({ action, toolId, agentId,
projectId, environment })`, records a `permission_decision` audit event
(`data.via: "tool-execution-engine"`), and on `allowed: false` returns
`denied(permission_denied)` — **the handler never runs**. Deny-by-default and
`explicit deny > explicit allow > implicit deny` are unchanged from Phase 2A.
This is _in addition to_ the orchestrator's pre-dispatch `requiredPermissions`
gate — both apply.

## 7. Approval flow

`toolApprovalRequired(tool, request)` triggers when `approvalPolicy.always`, or
`request.environment` is in `approvalPolicy.environments`, or `request.action`
is in `approvalPolicy.actions`. On trigger the engine:

1. `ApprovalSystem.request(...)` → audits `approval_requested`
2. records the request in a pending map, emits `approval_required`
3. returns `status: "approval_required"` with `approvalId` — **the handler does
   not run**

A human (or API/UI) then `approvals.decide(approvalId, "approved"|"rejected",
by)`, and the caller calls `engine.resume(requestId)` (optionally with
`{ asOf }` to lapse an expiry). `resume` audits `approval_decided`, re-checks
permissions, and either runs the tool (approved) or returns
`denied(approval_rejected | approval_expired)`. Resuming before a decision
throws. Read-only tools (no `approvalPolicy`) are never gated. This is
orthogonal to the task-level `ApprovalPolicy` used by the orchestrator.

## 8. Tool policies (deny-by-default)

The policy inputs live **on the tool definition** (`allowedAgents`,
`allowedProjects`, `allowedEnvironments`, `requiredPermission`,
`approvalPolicy`, `timeoutMs`, `limits`) plus the `PermissionSystem` grants; the
engine is the single evaluation point, with pure predicates in
`core/tools/tool-policy.ts` (`agentAllowed`, `projectAllowed`,
`environmentAllowed`, `toolApprovalRequired`). All dimensions —
agent / project / tool / action / environment — deny unless explicitly
permitted.

## 9. Execution limits

`ToolExecutionLimits` (per tool; `DEFAULT_TOOL_LIMITS` = 25 / 200 / 30000ms /
64KiB / 1MiB):

| Limit              | Enforced                                                                         |
| ------------------ | -------------------------------------------------------------------------------- |
| `maxCallsPerTask`  | Ledger keyed `taskId::toolId`; counted on execution attempt.                     |
| `maxCallsPerAgent` | Ledger keyed `agentId::toolId`.                                                  |
| `maxDurationMs`    | Per-call ceiling; the effective timeout is `min(tool.timeoutMs, maxDurationMs)`. |
| `maxInputBytes`    | `TextEncoder(JSON.stringify(input)).length` checked before running.              |
| `maxOutputBytes`   | Checked after running; over-limit → `failure(output_too_large)`.                 |

The engine's `limits` constructor option is a hard ceiling applied on top
(`min(tool, engine)`) — an ops kill-switch. Exceeding any limit stops
execution, returns a structured `failure`, and emits a `tool_execution`
`limit_exceeded` event. There are no loops — one `execute` call runs one tool
once.

## 10. Lifecycle

`REGISTERED` (registry) → `AVAILABLE` → `REQUESTED` → `VALIDATED` → `RESOLVED` →
`AUTHORIZED` → `APPROVAL_REQUIRED` → `APPROVED` → `EXECUTING` → `COMPLETED` |
`FAILED` | `TIMEOUT` | `DENIED` | `LIMIT_EXCEEDED`. Represented as the
`ToolExecutionStatus` on the result plus `data.phase` on the `tool_execution`
audit events (`TOOL_EXECUTION_PHASES`), consistent with how General Agents use
`agent_activity` — execution is synchronous within one `execute`/`resume` call,
so there is no stored state-machine object.

## 11. Audit events

| Prompt event                           | Recorded as                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| tool registered                        | `tool_registered`                                                                   |
| tool requested / validation            | `tool_execution` phase `requested` / `validated`                                    |
| permission decision                    | `permission_decision` (+ `tool_execution` `authorized`/`denied`)                    |
| approval requested / decision          | `approval_requested` / `approval_decided` (+ `approval_required`/`approved` phases) |
| execution started / completed / failed | `tool_execution` phase `executing` / `completed` / `failed`                         |
| tool timeout / denied / limit exceeded | `tool_execution` phase `timeout` / `denied` / `limit_exceeded`                      |

Never logged: API keys, authorization headers, passwords, credentials, or tool
**output payloads** (only sizes and counts).

## 12. Security model

- Deny-by-default at every dimension (agent, project, environment, permission).
- Least privilege: a tool lists exactly which agents may call it.
- Project + environment isolation enforced before the handler runs.
- Explicit permissions (`PermissionSystem`) and explicit approvals
  (`ApprovalSystem`); the engine never bypasses either.
- Handlers get a minimal context — no permission system, no credentials, no
  shell, no filesystem.
- Agents cannot reach a tool except through the engine.

## 13. Building a new tool

```ts
import { makeInMemoryTool } from "./adapters/index.js";
import { DEFAULT_TOOL_LIMITS } from "./core/index.js";

const summariseDoc = makeInMemoryTool(
  {
    id: "docs.summarise",
    name: "Summarise Document",
    description: "Return a short summary of a document by id.",
    version: "1.0.0",
    capabilities: ["summarisation"],
    requiredPermission: { action: "read" },
    allowedAgents: ["documentation-agent"],
    allowedProjects: ["*"],
    allowedEnvironments: ["local", "test", "staging"],
    timeoutMs: 10_000,
    limits: { ...DEFAULT_TOOL_LIMITS, maxCallsPerTask: 20 },
    inputSchema: (v) => {
      if (
        !v ||
        typeof v !== "object" ||
        typeof (v as { id?: unknown }).id !== "string"
      ) {
        throw new Error("expected { id: string }");
      }
    },
    metadata: { readOnly: true },
  },
  async (input) => {
    // no network / fs / shell here — call a provider you were given, return data
    return { summary: `summary of ${(input as { id: string }).id}` };
  },
);

registry.register(summariseDoc);
```

State-changing tools set `approvalPolicy` (e.g. `{ always: true }` or
`{ environments: ["production"] }`) and a non-`read` `requiredPermission`. Never
implement unrestricted shell, deployment, arbitrary filesystem writes, or
credential access.

## 14. How an agent requests a tool

```ts
const request = engine.createRequest({
  taskId: task.id,
  agentId: this.agentId,
  projectId: task.projectId,
  toolId: "docs.summarise",
  action: "read",
  input: { id: "doc-42" },
  environment: this.environment,
});
const result = await engine.execute(request);
if (result.status === "success") {
  use(result.output);
} else if (result.status === "approval_required") {
  // park; resume later with engine.resume(request.requestId)
} else {
  // structured failure/denied/timeout — map result.error.reason
}
```

The **Research Agent** does exactly this (`callTool` in
`agents/research/research-agent.ts`) and maps the result back onto an
`AgentExecutionError` on anything other than `success`.
