# ADR-0018: Controlled build, test and verification runtime (EO-4.4)

- Status: Accepted
- Date: 2026-09-24

## Context

EO-4.3 lets agents change files in a leased workspace. Changes need evidence
that they build, pass tests and leak no secrets. That evidence must come
without a general-purpose terminal, arbitrary package scripts, dependency
installs, commits or deployments.

## Decision

1. A `VerificationService` runs the build, test and security stages of an
   exact plan revision. Each stage runs one registered operation, chosen by a
   trusted per-project `VerificationProfile`, and each stage is a normal
   `ExecutionManager` session.
2. Build and test tools are defined with fixed argv (`defineBuildTool`):
   - they take no input;
   - shells, eval flags and install, publish or deploy arguments are refused;
   - declared dependencies must already exist (`DEPENDENCY_MISSING`).
3. Project code (`executionClass: "project_code"`) runs on a host
   `WorkspaceBuildRunner` only with an explicit `trustedHostBuild` policy
   opt-in. The runner reports no filesystem or network isolation, and results
   record the isolation they actually had.
4. The stage graph is validated before execution:
   - no cycles and no unknown stages;
   - fail-fast or continue;
   - bounded parallelism, with write stages run exclusively;
   - retries only for transient execution errors.
5. Evidence:
   - a source fingerprint before and after the run;
   - ChangeSet statuses `verifying`, `verified` and `verification_failed`;
   - SHA-256 artifact records with integrity checks;
   - bounded, redacted logs;
   - deep-frozen results.
6. Automated security checks without a planned reviewer run as the
   component's build agent in its build environment. Agent security reviews
   still require a reviewer.

## Consequences

- VERIFIED is evidence for one source fingerprint. It is never a commit,
  push or deployment.
- Host builds are only as safe as the repository is trusted. OS-level
  isolation is required before untrusted code is verified.
- Platform presets (dotnet, gradle, xcode, unity, unreal) exist as data. They
  run only once an environment reports the toolchain and composition
  registers the tool.
- API and UI exposure is deferred.
