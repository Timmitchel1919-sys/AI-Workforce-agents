# ADR-0006: Secure Tool & Execution Framework

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [ADR-0001](0001-modular-provider-agnostic-workforce.md),
[ADR-0005](0005-general-agent-pattern.md)

## Context

Phase 3 shipped the Research Agent with its own `assertTool` / `invokeTool`
helpers over a `ToolProvider`. Every future agent (Project Manager, Developer,
QA, Security, Finance, Business, Design, Documentation) would otherwise
re-implement that plumbing — and each re-implementation is a chance to skip a
permission check, an approval, or a limit. We need **one** enforcement point.

## Decisions

### 1. A first-class `Tool` contract carries its own policy

`contracts/tools.ts` adds `ToolDefinition` (id/name/version/capabilities,
`requiredPermission`, `approvalPolicy`, `allowedAgents` / `allowedProjects` /
`allowedEnvironments`, `timeoutMs`, `limits`, optional input/output schema
validators) and `Tool = ToolDefinition & { execute(input, ctx) }`. The old
`ToolProvider` (`ToolRequest` / `ToolResponse`) stays as the low-level vendor
shape a handler may wrap; the framework request/result are
`ToolExecutionRequest` / `ToolExecutionResult` (aliased `ToolResult`) to avoid a
name clash.

### 2. `ToolRegistry` — validated, frozen, controlled updates

Registration runs `validateToolDefinition` and `Object.freeze`s the definition
(nested). The only sanctioned change is `update(id, changes)`, which
re-validates. `describe(id)` exposes metadata without the handler or schema
functions. Registration emits `tool_registered`.

### 3. `ToolExecutionEngine` — the single secure pipeline

`execute(request)` runs a fixed sequence: validate request → resolve tool →
agent/project/environment eligibility → input-size + per-task/agent call limits
→ `PermissionSystem.evaluate` (+ `permission_decision` audit) → approval policy
(park with `approval_required`, `resume` after a decision) → run handler with
timeout → output-size + output-schema → `ToolExecutionResult`. Deterministic
(injectable clock; the happy path never branches on wall-clock). Every step is a
`tool_execution` audit event with a `data.phase`.

### 4. One audit type for tool execution

`tool_execution` with a `data.phase` discriminator, plus the reused
`permission_decision` / `approval_requested` / `approval_decided`, and a
separate `tool_registered` for registry lifecycle. Two new `AuditEventType`
literals total — same "don't grow the enum per component" approach as
`agent_activity` in ADR-0005.

### 5. Limits are per-tool, with an engine-wide ceiling

`ToolExecutionLimits` (calls per task, calls per agent, per-call duration, input
bytes, output bytes) live on the definition; the engine's `limits` option caps
them (`min(tool, engine)`) as an ops kill-switch. One `execute` runs one tool
once — no loops.

### 6. Approval is opt-in per tool, orthogonal to task approval

A tool with no `approvalPolicy` is never gated. The tool-level gate
(`approval_required` → `resume`) is independent of the orchestrator's task-level
`ApprovalPolicy`. Read-only research tools stay unapproved; a future
write/deploy tool sets `approvalPolicy: { always: true }` or
`{ environments: ["production"] }`.

### 7. The Research Agent is migrated onto the engine

`ResearchAgentConfig` drops `tools: ToolProvider` + `permissions:
PermissionSystem` for `toolEngine: ToolExecutionEngine`. The agent's
`assertTool` / `invokeTool` are replaced by `callTool` — build a
`ToolExecutionRequest`, `engine.execute(...)`, map non-`success` onto a
structured `AgentExecutionError`. Agent-level limits (`AgentRun.countToolCall`,
`checkDeadline`) are kept on top of the engine's limits.

## Options considered

| Concern              | Chosen                                                     | Rejected                                                                   |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| Enforcement point    | one `ToolExecutionEngine` every agent must use             | per-agent helpers (Phase 3) — each a chance to skip a check                |
| Tool policy home     | on the `ToolDefinition` + `PermissionSystem`               | a separate policy DSL / rules engine (over-engineered for the need)        |
| Schema               | `(value) => void` validator functions                      | a schema library (new dependency; the codebase already validates this way) |
| Request/result names | `ToolExecutionRequest` / `ToolResult`                      | renaming the Phase 1 `ToolRequest`/`ToolResponse` (invasive churn)         |
| Timeout              | injectable clock + cooperative check + a `setTimeout` race | real timers only (non-deterministic tests)                                 |
| Audit                | one `tool_execution` type + phases                         | ~12 literal event types                                                    |

## Consequences

- No agent can reach a tool except through the engine; a test asserts a denied
  or unapproved tool's handler never runs.
- Adding a tool = a validated `ToolDefinition` + a handler + `registry.register`.
- Future agents get permissions, approval, eligibility, limits, and audit for
  free by calling `engine.execute`.
- `ToolProvider` / `StaticResearchToolProvider` remain for back-compat but new
  work targets `Tool` + the registry.
- Genuinely-hung handlers rely on a real `setTimeout` race (unref'd); the
  deterministic tests exercise the cooperative clock-check path.
