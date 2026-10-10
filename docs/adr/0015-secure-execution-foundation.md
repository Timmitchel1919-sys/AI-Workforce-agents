# ADR-0015: Secure execution foundation — deny by default, no raw shell (EO-4.1)

- Status: Accepted
- Date: 2026-09-24

## Context

EO-3 produces authoritative, versioned execution plans. Before any plan stage
may run, the system needs a control boundary that re-validates everything the
plan assumed, isolates work per project, bounds resources and records
evidence — without introducing a general-purpose command runner. EO-3.4 (the
formal EO-3 release gate) was waived by the repository owner; EO-4.1 relies on
the EO-3.1–3.3 planning, persistence and review capabilities as implemented.

## Decision

1. A typed contract module (`contracts/execution.ts`) defines requests,
   policies, capabilities, grants, workspaces, sandbox providers, limits,
   network policy, secret references, sessions, attempts, receipts and a
   normalized error model. No type carries a command string, a caller-chosen
   executable or a secret value.
2. `ExecutionManager` (core) is the only coordinator. Pre-flight re-validates,
   in order: authorization (new `prepare_execution` capability + project
   scope), exact plan revision, stage, registered operation and its
   `ToolRegistry` tool, structured input and workspace paths, agent
   qualification, policy, environment eligibility, approval state, and sandbox
   availability. It returns all failing reasons; it never executes.
3. Policies are immutable and versioned; evaluation is deny-unless-permitted
   with exact matches only and no capability implication. Production registers
   `baseline-deny-all@1` (no rules) as the fallback.
4. Execution risk extends the existing approval risk scale with `critical`;
   risk is fixed on the server-side operation definition.
5. Sessions have a strict lifecycle with terminal states and separate attempts;
   creation is idempotent. Cancel (operators) and kill (administrators) are
   Control Plane commands scoped to one session.
6. No sandbox provider and no operation are registered in production, and no
   API creates sessions or runs anything in EO-4.1.

## Consequences

- Every production pre-flight is `DENIED` today — an honest state, visible in
  the Execution readiness panel, not a failure.
- EO-4.2 must add real providers that enforce the declared limits, realpath
  checks (`assertRealPathWithinRoot`), a durable session/receipt store and a
  secret broker before any policy may permit an operation.
- The Control Plane redactor and execution output redaction now share one
  secret-value pattern (`KNOWN_SECRET_VALUE_PATTERN`).
