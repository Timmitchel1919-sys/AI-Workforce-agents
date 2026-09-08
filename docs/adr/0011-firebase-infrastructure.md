# ADR-0011: Firebase infrastructure & persistence (Phase 7B)

**Status:** Accepted
**Date:** 2026-09-08
**Related:** [ADR-0002](0002-local-json-file-persistence.md),
[ADR-0009](0009-workforce-control-plane.md),
[ADR-0010](0010-control-plane-backend.md)

## Context

Phase 7A left three ports unimplemented — `OperatorDirectory` (auth),
`ControlEventPublisher` (real-time), and a persistence seam — and noted that a
Firestore repository "requires an ADR-gated async interface revision". The
Firebase project `ai-workforce-agents` now exists. Phase 7B connects the Control
Plane to it **as an infrastructure adapter**, and adds the HTTP API a browser UI
(Phase 7C) will consume.

Constraint from every prior phase: the Workforce core stays free of vendor SDKs
and `npm test` stays fully offline and deterministic.

## Decisions

### 1. `AsyncRepository<T>` is additive; core stays synchronous

`contracts/persistence.ts` gains `AsyncRepository<T>` alongside the untouched
sync `Repository<T>`. **No core system is migrated to async.** A networked store
is bridged to sync by `CachedRepository` (`core/persistence/`): `hydrate()` once
during wiring, serve every read from an in-memory copy, write through on a
serialized queue. A backing-store write failure is reported via `onError` (the
caller already observed the write locally); `flush()` drains the queue on
shutdown. Consistency is single-writer — one process owns the cache — which is
correct for the current single-instance API and is the documented limitation.

Rejected: migrating `TaskSystem` / `ApprovalSystem` / `WorkflowSystem` /
`AuditLog` and every test to `async` — an enormous, high-risk change for a phase
whose job is "Firebase is an adapter".

### 2. `firebase-admin` is an optional peer dependency, loaded lazily

Exactly the `@anthropic-ai/sdk` pattern (ADR-0004). `adapters/firebase/` is the
only code that knows Firebase exists; `firebase-services.ts` loads
`firebase-admin` with a dynamic `import()` and exposes three narrow seams —
`FirestoreLike`, `FirebaseAuthLike`, `FirebaseStorageLike`. Adapters and tests
are written against the seams; tests inject fakes and never import
`firebase-admin`. `npm test` stays offline.

### 3. Four adapters, each behind a contract port

| Adapter                     | Port                     |
| --------------------------- | ------------------------ |
| `FirestoreRepository<T>`    | `AsyncRepository<T>`     |
| `FirebaseOperatorDirectory` | `OperatorDirectory`      |
| `FirestoreEventPublisher`   | `ControlEventPublisher`  |
| `FirebaseObjectStore`       | `ObjectStore` (new port) |

`OperatorDirectory`, `ControlEventPublisher`, `ControlPlaneEvent`, and
`ControlRepository<T>` moved from `control/ports.ts` to `contracts/control.ts`
so an adapter can implement them without importing `control/`; `control/ports.ts`
re-exports them.

### 4. A dependency-free HTTP API (`api/`)

`createControlPlaneApi({ query, command, operatorDirectory })` returns a Node
`http` request handler — no Express, no framework. It authenticates every
non-health route via `Authorization: Bearer <token>` → `OperatorDirectory`,
threads an `x-correlation-id` header into command `options.correlationId` and
back onto the response, maps `ControlErrorKind` and the `WorkforceError`
hierarchy to status codes, and forwards everything else to the two services. It
never sends a stack trace. It is **not** the authority — the services still
enforce authorization, approval, state, project isolation, and audit.

### 5. Firestore & Storage rules deny all client access

`firestore.rules` / `storage.rules` are `allow read, write: if false`. Every
read and write goes through the Admin SDK server-side (rules-exempt). This makes
the Phase 7C rule — "the UI MUST NOT touch Firestore directly" — impossible to
violate from a browser. The UI receives only API responses and time-limited
signed URLs.

### 6. Tests use fakes, not the emulator

`npm test` covers `CachedRepository`, all four adapters, and the HTTP API with
hand-written in-memory fakes of the seams — deterministic, offline, no Java, no
`firebase-tools`. The Firebase emulator is configured in `firebase.json` and
documented for local end-to-end runs, but nothing in CI depends on it.

## Consequences

- 329 tests (+23); typecheck / lint / build green; **zero** change to `core/`
  behaviour or `control/` logic (only the ports moved).
- `firebase-admin` is now installed (dev + optional peer); `npm ci` in CI pulls
  it but no test touches it.
- The exact `ControlPlaneContext` composition (which collections are
  Firestore-backed vs. in-memory, orchestrator wiring) is left to the wiring
  layer and documented in `docs/firebase.md` — it depends on operational
  choices outside this phase's scope.
- Multi-instance deployment needs the single-writer limitation addressed
  (per-collection leasing, or a move to real async repositories). Deferred.
