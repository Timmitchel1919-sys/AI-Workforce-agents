# ADR-0034: Production runners and release adapters (R1–R8)

- Status: Accepted
- Date: 2026-10-17

## Context

ADRs 0015–0022 defined the EO-4 execution chain as a **control boundary**
with no real runners, no real deployment adapter and no durable state. The
threat model (`docs/security/eo4-threat-model.md`) listed two consequences:

- "The host build runner is not isolated" — residual risk #2.
- "Deployed ≠ healthy; version mismatch; partial deployment" was fully
  modelled but had no provider to honor it.

Firestore-backed state landed in R1. R2 added the response-boundary flush
barrier. R2B deployed the Cloud Run worker. R3/R4/R5 added real runners and
adapters. R7/R8 close the remaining residual gaps.

## Decision

### R1 — Firestore durable state
Replace the in-memory execution-receipt, assignment and write-scope-lease
repositories with Firestore-backed write-through implementations. Each
exposes `.ready` (hydrate before serving) and `.flush()` (await pending
writes). Composition awaits `.ready` before the Control Plane accepts
traffic.

### R2 — HTTP response-boundary flush barrier
Dispatcher-wide barrier in `functions/control-plane-function.ts`:
`createControlPlaneHttpsAdapter` wraps `response.end()` with
`holdResponseUntilFlushed`, which awaits `runtime.flush()` (bounded by
`FLUSH_BEFORE_RESPONSE_MS`) before releasing the response. The production
runtime's `flush` awaits both `repositories.flushAll()` and the three R1
adapters' `flush()`.

### R2B — Cloud Run worker + enqueue path
Admin-only HTTP routes on the Control Plane (`POST /execution-jobs`, `GET`,
`POST .../cancel`) enqueue governed jobs; a Cloud Run worker claims and
drains them. `EXECUTION_WORKER_ENABLED` env var is the backend-authoritative
activation gate — unset → 503, nothing executes.

### R3 — Docker container runner (opt-in, fail-closed)
`DockerContainerRunner` implements `ExecutionRunner` and wraps every
`StructuredInvocation` in a hardened `docker run`:

```
run --rm --read-only --network=none --cap-drop=ALL
    --security-opt=no-new-privileges --user=<non-root>
    --pids-limit=<N> --name=<deterministic>
    [--memory=<cap> --memory-swap=<cap>] [--cpus=<cap>]
    <name>:<version>@<digest> <entrypoint> <argv...>
```

- images come from a trusted, composition-time `imagesByExecutable` map;
- the `ContainerPolicy` is re-evaluated on every call (approvedImages,
  requireDigest) — a revoked image fails CLOSED with
  `CAPABILITY_NOT_GRANTED`;
- unknown executableId → `TOOL_NOT_ALLOWED`, no docker call issued;
- `cancel()` aborts and issues `docker kill <container-name>`;
- the descriptor honestly reports `filesystemIsolation=true`,
  `networkIsolation=true`, `supportsKill=true`.

Activated via `AIW_CONTAINER_POLICY_JSON` + `AIW_DOCKER_RUNNER_JSON`. Without
both, the family stays `not_configured`.

**Effect on threat model:** residual risk #2 ("host build runner is not
isolated") is now mitigated for projects that select the Docker runner.

### R4 — Firebase Hosting deployment adapter (opt-in, fail-closed)
`FirebaseHostingDeploymentAdapter` implements `DeploymentAdapter`:
- `deploy()` → `firebase deploy --only hosting:<siteId> --project <ref>
  --non-interactive --json`, parses `{ result: { "<siteId>": { release } } }`;
- `verify()` → HTTP GET `<siteBase>/__/release.json`; HEALTHY requires 200
  **and** `manifest.commit == candidate.commitSha` (a 200 alone is only
  `deployed`);
- `rollback(id)` → `firebase hosting:clone <id> <ref>:<channel>` — restores
  a KNOWN previous release by id, never "deploy latest".

Credentials ride into the child as `FIREBASE_TOKEN` env var only; never in
argv, logs or receipts. Activated via `AIW_FIREBASE_HOSTING_ADAPTER_JSON`.

### R5 — Docker workspace mounts + Firebase target wiring
- `WorkspacePathResolver` port: when provided and the `RunnerJobSpec` names
  a `workspaceId`, the runner bind-mounts the resolved host path at
  `/workspace` (`type=bind,source=<host>,target=/workspace[,readonly]
  ,bind-propagation=rprivate`), sets `--workdir=/workspace`, and refuses a
  non-absolute resolver output with `WORKSPACE_VIOLATION`.
- `AIW_FIREBASE_HOSTING_TARGETS_JSON` provides deployment targets with
  strict per-entry validation (regex on resource shape, bounded timeout,
  optional `secret://` credentialRef). Targets only register when the
  adapter does.

### R7 — Per-operator rate limit for mutations
Augment the existing route+IP rate limiter (`api/security/rate-limit.ts`) with
a POST-auth check keyed by `operator:<principal.id>` using a tighter
profile (`operator_mutation`). Applies to every non-GET route. Returns 429
with `Retry-After` and emits a `rate_limit_exceeded` canonical event.

**Effect on threat model:** residual risk #4 ("no rate limiting") is now
addressed. Function `maxInstances=1` stays as capacity cap; this adds a
per-identity cap on top.

### R8 — Production secret resolver (env-backed)
`EnvSecretBroker` + `EnvSecretValueResolver` in `adapters/vault/`:
- `secret://<name>` maps to env var `AIW_SECRET_<normalized>`, where
  `normalized` upper-cases, replaces every non-`[A-Z0-9]` byte with `_` and
  caps at 64 chars.
- `describe()` reports availability without returning the value.
- `issueHandle(ref, grant)` returns an opaque, grant-bound `SecretHandle`
  (handleId = HMAC(ref, grantId)), expiring at `grant.expiresAt`.
- `resolve(ref)` is the `SecretValueResolver` that
  `DeploymentOrchestrator.credentials` needs; it returns the raw env value
  only to a trusted provider adapter (never serialized, never audited).

Wire `DeploymentOrchestrator.credentials` to the `EnvSecretValueResolver`
in production, so a Firebase hosting target with `credentialRef:
"secret://firebase-token"` reads from `AIW_SECRET_FIREBASE_TOKEN`. Without
that env var, `resolve()` throws → the deployment aborts BEFORE calling the
provider (fail-closed).

**Effect on threat model:** credential rows in `release` and `receipt`
tests remain unchanged — the broker still enforces that the raw value
never reaches argv, logs, receipts or audit.

## Consequences

- **Platform honesty matrix** (threat model) updates:
  - "Node (Linux/Windows host)" — real runner verified, production **can** register.
  - "Docker" — contract **and** real runner, production registers via
    `AIW_DOCKER_RUNNER_JSON`.
  - "Firebase deployment" — contract **and** real adapter, production
    registers via `AIW_FIREBASE_HOSTING_ADAPTER_JSON`.
  - All other families (macOS/Android/Linux/Cloud/Unity/Unreal) remain
    contract-only.
- Residual risk #2 ("host build runner not isolated") is **removed** for
  projects that select the Docker runner; a project still has to opt in.
- Residual risk #4 ("no rate limiting") is **removed**.
- Residual risk #5 ("DNS rebinding") remains open with a sharper statement:
  the Docker runner currently always uses `--network=none`, so the risk
  does not apply here; it becomes relevant only when a future policy opts
  into `allow_approved_hosts` with resolved-address checks.

## Not in R1–R8

- A full Google Secret Manager adapter (R8 uses env vars that Firebase
  Functions already backs with Secret Manager via `defineSecret`).
- A workspace resolver implementation (R5 only adds the port; a resolver
  that bridges the `WorkspaceRepositorySandbox` host path remains to be
  composed).
- Real runners for macOS/Android/Linux/Cloud/Unity/Unreal.
- Autonomous rollback: still off by default, still per-policy.
