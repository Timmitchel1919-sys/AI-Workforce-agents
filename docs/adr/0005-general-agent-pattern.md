# ADR-0005: General Agent pattern + Research Agent

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [ADR-0001](0001-modular-provider-agnostic-workforce.md),
[ADR-0004](0004-model-provider-layer-anthropic.md)

## Context

Phase 3 introduces the first real reusable agent (Research) and, with it, a
pattern the next nine agents (Project Manager, Developer, Data Analyst, QA,
Security, Finance, Business, Design, Documentation) can follow without
re-deciding structure each time. Constraints: agents must operate through the
existing Workforce (orchestrator, registry, permissions, approvals, context,
audit, `ModelProvider`, `ToolProvider`); must not be autonomous loops; must not
contain project-specific logic.

## Decisions

### 1. A General Agent = an `Agent` definition + an `AgentExecutor`

`AgentExecutor` and `PermissionGuard` move from `core/orchestrator` to
`contracts/` (their true home). A General Agent registers a declarative `Agent`
in the `AgentRegistry` and provides an `AgentExecutor` the orchestrator
dispatches to. No orchestrator change.

### 2. `RoutingAgentExecutor` fans the single orchestrator executor out by agent id

The orchestrator holds one `AgentExecutor`. `RoutingAgentExecutor`
(`core/agents/`) maps `agent.id → AgentExecutor`, so many agents coexist behind
it. Unknown agent → `NotFoundError`.

### 3. `GeneralAgent` base owns the invariant pipeline

`GeneralAgent<TInput, TOutput>` (`core/agents/`) runs a fixed, **non-recursive**
sequence: `validateInput → run → validateOutput`, wrapped in `agent_activity`
audit events and a single structured failure type (`AgentExecutionError`, with a
machine-readable `reason` + `details`). Subclasses implement only the domain
steps. An `AgentRun` handed to `run` meters the limits and emits audit events.

### 4. Hard limits, deterministic, configurable

`AgentLimits` = `maxIterations` / `maxToolCalls` / `maxModelCalls` /
`timeoutMs` (contract-level defaults in `DEFAULT_AGENT_LIMITS`). The clock is
injectable so timeout is testable without real waiting. There is no "loop until
done" — the Research pipeline is linear (plan → collect → synthesize).

### 5. One audit type for agent activity

`agent_activity` with a `data.kind` discriminator, rather than ~10 new
`AuditEventType` literals per agent. Queryable by `type` then `kind`; scales to
nine more agents without growing the enum. Model calls are still separately
audited by `AuditedModelProvider` (`model_execution_*`).

### 6. Structured task/result contracts live in `contracts/`

`contracts/research.ts` holds `ResearchTask` / `ResearchResult` +
`validateResearchTask` / `validateResearchResult`. Reusable across projects, no
project logic. The agent validates input on entry and output before returning —
never returns an unstructured string.

### 7. Deterministic source evaluation and confidence

Source `reliability` is a function of source type + retrieval outcome (+ an
optional provider `reputation`), never model wording. Confidence is a fixed
weighted formula over verified-source coverage, mean reliability, finding
support ratio, and sub-question coverage, with hard downgrade rules. The
synthesis model is explicitly instructed **not** to assign confidence or invent
sources; post-processing drops uncollected citations and downgrades unsupported
facts.

### 8. Least privilege + targeted approval

`researchAgentGrants()` allows only `execute research.search` and `read
research.fetch`; denies `write` / `deploy` / `secret_access` /
`external_communication`. Every tool call is asserted against the
`PermissionSystem` inside `run` (in addition to the orchestrator's pre-dispatch
gate). `researchApprovalPolicy` gates a research task **only** when it also
declares a state-changing/outbound requirement — read-only research needs no
approval; the existing approval model is not weakened.

## Options considered

| Concern              | Chosen                                         | Rejected                                                                                                                 |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Multi-agent dispatch | `RoutingAgentExecutor` behind the one executor | changing the orchestrator to hold a map (more surface, breaks Phase 2A tests)                                            |
| Agent structure      | `GeneralAgent` base class                      | ad-hoc per agent (no shared limits/audit/error contract); a full planner/executor loop (explicitly out of scope, unsafe) |
| Audit events         | one `agent_activity` type                      | one literal per phase per agent (enum explosion)                                                                         |
| Confidence           | deterministic formula in code                  | trust the model's stated confidence (not evidence-based, non-reproducible)                                               |
| Result shape         | typed `ResearchResult` contract                | free-text summary (not machine-checkable, no source grounding)                                                           |

## Consequences

- Nine future agents follow §12 of
  [research-agent.md](../agents/research-agent.md) — new contract file + a
  `GeneralAgent` subclass + a definition + grants + tests.
- `core/agents/` is provider-neutral; `agents/` (top-level) holds concrete
  agents and is added to `tsconfig` `include`.
- A test asserts `agents/` has no Anthropic dependency.
- The Research Agent does not deduplicate sources by URL, does not retry, and
  runs a single collect pass — deliberate for a first, non-autonomous version.
