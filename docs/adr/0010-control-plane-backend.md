# ADR-0010: Control Plane backend hardening (Phase 7A)

**Status:** Accepted
**Date:** 2026-09-08
**Related:** [ADR-0009](0009-workforce-control-plane.md),
[ADR-0002](0002-local-json-file-persistence.md)

## Context

ADR-0009 delivered the Control Plane: `WorkforceQueryService`,
`WorkforceCommandService`, a three-tier role model, per-command audit, project
scoping, and a dependency-free dashboard. Phase 7A prepares that backend to be
wrapped by a future HTTP API, a Firebase persistence/auth adapter, and a
real-time channel — **without** building any of them yet — and closes small gaps
in traceability and error semantics.

## Decisions

### 1. Correlation ids on every command

`ControlCommandResult` gains a required `correlationId`; `CommandOptions
{ correlationId? }` is an optional third argument on every command. A non-empty
caller value is used verbatim; otherwise `createCorrelationId()` mints one with
`core/shared.ts::createId` (prefix `corr_`) — no new id infrastructure, still
deterministic in tests. The id is written to `data.correlationId` on the
`control_command` audit event and is a queryable filter.

### 2. An `errorKind` refinement, not a new outcome

`outcome` stays `executed | denied | rejected`. A new `ControlErrorKind`
(`invalid_request | unauthorized | forbidden | not_found | invalid_state |
approval_failure | command_failure`) is set on every non-`executed` result, so a
future HTTP layer has a stable status-code mapping. `control/errors.ts` adds
`ForbiddenError`, `InvalidControlStateError`, `ApprovalActionError`,
`CommandFailedError` over the existing `WorkforceError` hierarchy, plus
`classifyErrorKind`. DTOs never carry a stack trace.

### 3. `UNKNOWN` health status

`HEALTH_STATUSES` gains `unknown`. An unmeasured component (e.g. `model-provider`
with no live probe) now reports `unknown`, not `degraded` — unmeasured is not
impaired. Overall precedence is `unavailable > degraded > unknown > healthy`.
This changed one existing assertion (`control-plane.test.ts`: the unchecked
provider is `unknown`).

### 4. Named ports for later adapters

`control/ports.ts` declares — as pure interfaces, unimplemented —
`OperatorDirectory` (credential → `OperatorPrincipal`, the Firebase Auth seam),
`ControlEventPublisher` (real-time fan-out; a successful command publishes a
`command_result` event; a throwing publisher never breaks the command),
`ControlRepository<T>` (alias of the existing `Repository<T>`, the Firestore
seam), and `ProviderHealthProbe` / `ToolHealthProbe`. `ControlPlaneContext`
gains an optional `events` publisher.

### 5. Persistence stays synchronous; Firebase is a future adapter

`Repository<T>` is synchronous by design (ADR-0002). A Firestore adapter needs an
ADR-gated async revision — explicitly **out of scope** for 7A. Both control-plane
stores already accept an injected `Repository<T>`, so Phase 7B swaps persistence
with no change to `control/`. No Firebase SDK, project, config, rules, Auth,
Hosting, or Functions were added.

### 6. Small query additions

`TaskQuery` gains `createdAfter` / `createdBefore`; `AuditEventQuery` gains
`actor` / `correlationId`; `getHealth` is renamed to `getSystemHealth` with
`getHealth` kept as a deprecated alias.

## Options considered

| Concern             | Chosen                               | Rejected                                                       |
| ------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Correlation id type | reuse `createId`, `corr_` prefix     | UUID dependency; a bespoke id scheme                           |
| Error signalling    | `errorKind` on the result            | a fourth `outcome`; throwing for expected rejections           |
| Health of unchecked | `unknown`                            | keep `degraded` (implies a problem that has not been observed) |
| Firebase seam       | unimplemented ports + injected repos | an async `Repository` revision now (ADR-gated, premature)      |
| Real-time seam      | `ControlEventPublisher` no-op port   | build SSE/WebSocket now                                        |

## Consequences

- 306 tests (18 new; 1 existing assertion updated); typecheck / lint / build all
  green; no `core` behaviour change.
- A future HTTP API wraps the two services unchanged and maps `errorKind` to
  status codes.
- Phase 7B can implement `OperatorDirectory`, `ControlEventPublisher`, and a
  Firestore `Repository<T>` as adapters without touching `control/` — pending the
  async-persistence ADR.
- Health is now honestly tri-valued: healthy / impaired / unmeasured / down.
