# ADR-0016: Bounded tool execution through the existing tool pipeline (EO-4.2)

- Status: Accepted
- Date: 2026-09-24

## Context

EO-4.1 established the execution control boundary (policies, grants,
sessions, pre-flight) but executed nothing. EO-4.2 must execute registered,
policy-authorized, schema-validated operations without introducing a terminal,
a raw command contract or a second execution engine.

## Decision

1. `ExecutionManager.invoke` is the only entry point. It re-runs every
   pre-flight gate against the session exact plan revision, then checks live
   capability grants, environment compatibility, limits and concurrency.
2. Execution tools are registered at trusted composition into both the new
   `ExecutionToolRegistry` and the existing `ToolRegistry`; every invocation
   passes through the existing `ToolExecutionEngine`. The engine-facing
   handler accepts only an opaque, single-use invocation reference.
3. Process execution is isolated in one unexported adapter
   (`bounded-process-runner`): trusted absolute executable, template argv,
   constructed environment, `shell: false`, bounded output, process-tree kill.
4. Sandbox selection never assumes isolation. A non-isolating host provider
   serves only operations with no workspace and no network access, and only
   when a policy rule explicitly opts in (`hostProcess`).
5. The initial allowlist is a single diagnostic operation, `node.version`.
6. Production composition is unchanged: no provider, no permitting policy, no
   HTTP route. Nothing executes in production.

## Consequences

- Denials are receipted and audited as denials, separate from tool failures.
- Windows children always receive libuv system baseline variables; credentials
  are never passed. Documented rather than claimed away.
- EO-4.3 must add isolating providers before any workspace, build, test or
  network operation can be permitted.
