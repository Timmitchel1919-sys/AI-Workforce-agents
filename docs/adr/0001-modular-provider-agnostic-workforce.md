# ADR-0001: Modular, provider-agnostic Workforce foundation

**Status:** Accepted
**Date:** 2026-09-06
**Deciders:** AI Workforce maintainers

## Context

The AI Workforce must coordinate AI agents across several independent products
(AIMS, Money Mind, Mastery, Tripod, and future projects) and across multiple AI
model and tool vendors. It must stay testable, auditable, and under explicit
human control for high-risk actions, while remaining small enough to evolve
quickly. Money Mind is the intended first real integration, but its source must
not be copied into this repository.

## Decision

Adopt five foundational decisions.

### 1. Modular monolith

One deployable TypeScript codebase with clear internal module boundaries
(`contracts/`, `core/`, `adapters/`). Dependencies flow one way
(`core → contracts`, `adapters → contracts`); `core` never imports `adapters`.
No microservices, no message brokers, no runtime dependencies in Phase 1.

### 2. Provider abstraction

Model and tool access is defined by provider-neutral interfaces
(`ModelProvider`, `ToolProvider`). The core imports no vendor SDK. Concrete
providers (OpenAI, Anthropic, Google, …) are added later as adapters and
injected at wiring time. Phase 1 ships only offline in-process doubles.

### 3. Project adapters

Each real project is reached through a `ProjectAdapter` exposing a fixed,
declared capability list. `BaseProjectAdapter` rejects any undeclared
operation. Project code is never vendored in; adapters call the project's own
API/CLI. Context is isolated per project id.

### 4. Deny-by-default security

`PermissionSystem` denies every request unless an explicit grant matches.
Requests are scoped by agent, project, tool, action, and environment.
Precedence is explicit-deny > explicit-allow > implicit-deny. Least privilege
is declared on each agent.

### 5. Human approval

`ApprovalSystem` records human decisions as a first-class lifecycle
(`requested → approved | rejected | expired`). It never grants access itself;
it produces an auditable record that a UI/API layer can later drive.

## Options considered

### Option A — Modular monolith with explicit contracts (chosen)

| Dimension        | Assessment                                       |
| ---------------- | ------------------------------------------------ |
| Complexity       | Low initially; boundaries allow later extraction |
| Cost             | Low — no infrastructure, no dependencies         |
| Scalability      | Adequate; module seams enable future split       |
| Team familiarity | High for TypeScript/Node                         |

**Pros:** deterministic tests, trivial deployment, clear contracts, nothing to
audit in the dependency tree.
**Cons:** independent scaling of a sub-component later needs deliberate
extraction work.

### Option B — Microservices with provider-specific implementations

| Dimension        | Assessment                               |
| ---------------- | ---------------------------------------- |
| Complexity       | High — distributed coordination up front |
| Cost             | Higher operational cost from day one     |
| Scalability      | More than current needs require          |
| Team familiarity | Lower                                    |

**Pros:** independent deployment boundaries.
**Cons:** distributed-systems overhead and provider lock-in arrive before there
is product value to justify them.

### Option C — Direct integration with one AI provider

**Pros:** fastest path to a first demo.
**Cons:** couples core behavior to one vendor's API and pricing; every later
provider becomes a rewrite; violates the multi-project, multi-provider goal.

## Consequences

- Provider abstractions keep OpenAI, Anthropic, Google, or any other vendor from
  defining core behavior.
- Project adapters preserve AIMS / Money Mind / Mastery / Tripod isolation.
- Deny-by-default permissions and recorded approvals make sensitive work
  reviewable after the fact.
- Deterministic, offline tests can cover the whole foundation.
- Durable storage, real authentication, asynchronous workers, retries, and
  production log shipping remain **future** decisions, each worth its own ADR.

## Action items

1. Keep contract compatibility guarded by tests.
2. Add integrations only through the adapter boundaries.
3. Write a follow-up ADR before introducing persistence or async execution.
