# ADR-0026: Production release-pipeline composition (EO-6.1)

- Status: Accepted
- Date: 2026-09-27

## Context

ADR-0025 recorded that the production Control Plane composed `execution` but
none of the release services, so the Spatial Graph reported those sources as
"not connected". This layer composes them — without pretending that composing
them gives production capabilities it does not have.

Production runs in a Cloud Function: no Git binary, no persistent workspace, no
sandbox provider and no deployment adapter. Its execution boundary is a
deny-all baseline by design.

## Decision

### Compose against the shared stores, fail closed where a capability is absent

`api/production-control-plane.ts` now constructs `ArtifactManager`,
`VerificationService`, `SourceControlOrchestrator` and `DeploymentOrchestrator`
with the SAME approvals, audit log, durable `ExecutionRecordStore` (Firestore),
operation registry and sandbox registry as the rest of the runtime (the
registries were hoisted so verification sees exactly what the execution manager
sees). Every missing capability is an explicit **unavailable port**
(`core/release/unavailable-ports.ts`): `UnavailableGovernedGit`,
`UnavailableWorkspaceControl`, `UnavailableArtifactSource`. They read honestly
(no workspace ⇒ no ChangeSet) and DENY everything else with the stable code
`ADAPTER_UNAVAILABLE` — never a no-op that reports success, never simulated.

The control-plane *context* still exposes only read views (`listHistory`,
`activity`, `listReleases`, `listTargets`) — least privilege: the graph and
Operations layers cannot call commit or deploy, and no HTTP route reaches them.
The full services are exposed on the trusted runtime object (`runtime.release`).

### Two separate facts: connected vs capable

`ReleaseCapabilities` (`contracts/release.ts`) is **derived at read time**
(`core/release/release-capabilities.ts`) from the ports and registries the
services were composed with — never declared and never a construction-time
snapshot: `verification` needs a sandbox provider *and* registered operations
*and* a real workspace *and* a real artifact source (a sandbox alongside the
fail-closed workspace does not advertise verification); `sourceControl` needs a
real Git port *and* a real workspace; `deploymentAdapters` is the live list from
`DeploymentOrchestrator.adapterIds()`. The stand-in ports carry
`available: false`. Production today: all absent.

- **NOT CONNECTED != EMPTY:** a source that does not exist is `notConfiguredSources`.
- **INERT != IDLE:** a source that is connected but has no capability behind it
  is `inertCapabilities` (graph metadata and insights, folded into the revision —
  every distinct capability state has a distinct revision — shown as "Connected,
  but not configured in this deployment: …, so an empty release history does not
  mean an idle pipeline").
- The Operations views keep reading **"not configured"** while the capability is
  absent (their `configured` means "the capability exists").

The control-plane *context* holds **read-only views** (`listHistory`; `activity`;
`listReleases`/`listTargets`) as plain wrapper objects, so the least-privilege
claim holds at runtime and not only by type. The full services live on
`runtime.release` for the trusted host.

### Production verification is an explicit stage (DEPLOYED != HEALTHY)

`core/release/production-verifier.ts` (`verifyProduction`) checks, per origin:
hosting availability, health (JSON `{"status":"ok"}`), that each protected route
is denied by the **API's own JSON 401/403** (a CDN error page is not the API) and
is not cacheable, that an unknown API route does not leak, and — when asked —
that the served UI bundle and the version the health endpoint **reports** are
exactly the release, compared **per origin** (a stale second origin is not masked).

Safety: origins must be https on an allowed host (default `*.web.app`,
`*.firebaseapp.com`), with no credentials, IP literal, port, path, query or
fragment, and are never echoed when rejected; paths are validated (no `//`, no
`..`); at least one protected route is required; one timeout covers the whole
request *including the body*; bodies are capped at 1 MB; redirects are not
followed; only GETs are sent; no credentials. A check that cannot be performed
FAILS (UNKNOWN != HEALTHY); the verdict is `healthy` only if every check passed.

`toPostDeployVerification(report)` adapts a report to the deployment
orchestrator's post-deploy contract. `reachable` requires **every non-version
check** to pass (an open protected route or a broken page is not "up"), and
`reportedVersion` comes **only from what production reports** — never a value the
adapter supplies — so the orchestrator can never compare a commit to itself.
Tested end-to-end on the real-Git rig: healthy only when verification passes and
production reports the shipped commit; a health failure, an open protected route,
a stale build, and a production that reports no version all end not-healthy.

`npm run verify:production -- --base https://… [--expect-bundle …]
[--expect-version <sha>]` runs it after a deploy (exit 0 only when healthy;
unknown/valueless/repeated flags are usage errors, exit 2).

**Limitation:** production's own `/api/health` does not report a build id yet
(`{"status":"ok"}` only). Until it does, `--expect-version` cannot pass and a
real adapter using the bridge cannot mark a release `healthy` — which is the safe
direction (UNKNOWN != HEALTHY). Adding a build id to the health response (and
setting it at build time) is a small follow-up.

### Onboarding coexistence

A `ready` provisioned project is registered (a single read-only `READ_PROJECT`
capability), readable through the same project-scoped release surfaces, and
granted **nothing** else: no capability, no execution policy, no plan. A
`blocked` project is not registered and appears nowhere. (PROJECT READY !=
AUTOMATIC EXECUTION.)

### Failure containment

Tested on the real-Git rig: a pending, rejected or wrongly-scoped approval
authorises nothing and each refusal records nothing; the commit approval does not
authorise the push; no deployment candidate exists without a push; and the
existing gates (review, re-verification, remote-changed) are unchanged.

## What is NOT in this layer (reported, not invented)

- **No real capability was added to production.** There is still no sandbox
  provider, no Git port and no deployment adapter in the production runtime, so
  production still cannot run verification, commit, push or deploy. Composition is
  the seam and the honest reporting; each capability is a separate adapter.
  A real GitHub-API git port, a Firebase deployment adapter and a cloud runner are
  the next dependency-ordered work.
- **Model Router, AI Cost Center, AI Auditor** remain unimplemented
  (`AuditBaseline` in `contracts/onboarding.ts` is a type, not an auditor).
- **Idempotency:** commit, push and deployment reservations are durable
  (`DurableLedger`); a duplicate delivery with the same key returns the same
  record. `retry-task` after a timed-out response remains state-machine based and
  can double-apply if the task failed again in between; the UI never auto-retries.

## Reconciliation record

At the start of this layer `main` (`4e2468c3`) = `c01b6053` + onboarding
(`8359ebf7`) + EO-5 (`a84a0242`); production = `c01b6053` + EO-5 only. The only
difference was the onboarding workstream. This layer validates `main` as a whole
and releases it, so production corresponds to validated `main`.
