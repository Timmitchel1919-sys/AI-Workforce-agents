# ADR-0019: Environment execution adapters and cross-platform runners (EO-4.5)

- Status: Accepted
- Date: 2026-09-24

## Context

AI Workforce must run bounded operations on different platforms: Windows/.NET,
macOS/Xcode, Android, Linux, Docker, cloud runners, Unity and Unreal. It must
do this without spreading platform logic through the ExecutionManager,
Control Plane or UI, and without faking support for platforms that cannot
execute.

## Decision

1. Keep these concepts separate:
   - EnvironmentDescriptor and EnvironmentInstance (EO-2 discovery);
   - EnvironmentExecutionAdapter (one family; pure evaluation of discovery
     metadata);
   - ExecutionRunner (bounded execution, heartbeat, lease, cancel);
   - Sandbox (the isolation a runner declares).
2. `EnvironmentAdapterRegistry` holds adapters and runners registered by
   trusted composition only. It resolves readiness deterministically from
   authoritative metadata and never from request strings, adapter names or
   URLs.
3. Each runner is exposed as a `SandboxProvider` that is only eligible when
   routed (`requiresRouting`). The manager pins the routed provider. A changed
   route denies the invocation, so failover always means a new, re-evaluated
   and audited session.
4. Platform facts live only in `adapters/environments/platform-adapters.ts`,
   and IDEs are not adapters. One shared evaluator covers:
   - host OS, toolchain versions, exact engine versions;
   - discovered targets, modules and GPU;
   - the container policy;
   - build ≠ sign ≠ publish.
5. Leases are bounded and expiring. A disconnect produces a normalized
   non-success outcome. Timeout and cancel propagate to the runner. Runner
   credentials are references resolved server-side.
6. Receipts and verification stages record environment, adapter, runner,
   toolchain and source-fingerprint evidence. Artifact handoff verifies
   digests and source fingerprints.

## Consequences

- The Windows host process runner is real. The other families are contracts
  tested with deterministic doubles, and the status API says so
  (`not_configured`).
- Real runners, remote transport, queueing and UI can be added without
  touching central orchestration.
