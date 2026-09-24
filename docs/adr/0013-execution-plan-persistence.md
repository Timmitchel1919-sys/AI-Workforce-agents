# ADR-0013: Transactional execution plan persistence (EO-3.2)

- Status: Accepted
- Date: 2026-09-23

## Context

EO-3.1 stored plans through the hydrate-once, write-through `CachedRepository`
(ADR-0011). That cache is single-writer: with several Cloud Functions
instances, two replans of the same plan could both write version N+1, and a
late background write could overwrite a newer document — duplicate versions,
two "current" revisions, corrupted history.

## Decision

1. Introduce the `ExecutionPlanStore` port (`contracts/planning.ts`): every
   plan mutation is one atomic `commit` with an optimistic precondition
   (`create_series`, `new_revision`, `transition`); a failed precondition is a
   `PlanRevisionConflictError` (409) and writes nothing.
2. `FirestoreExecutionPlanStore` implements it with Firestore transactions and
   a per-series head document (`execution_plan_heads/{planId}`); version
   documents are written with `create`.
3. Plans leave the write-through cache. The planning service keeps an
   in-process view that is refreshed from the store on every read
   (project/series equality queries) and on conflicts.
4. Stored records are validated on read (fail-closed `CorruptPlanRecordError`,
   HTTP 500 with a generic message); serialization is canonical.
5. No composite indexes: only single-field equality queries are used.

## Consequences

- Plan history cannot fork or be overwritten across instances.
- Every plan read costs one Firestore query; acceptable for operator traffic.
- `ExecutionPlanningService` lifecycle methods are asynchronous.
- Production requires a Firestore client with transactions (the Admin SDK);
  startup fails loudly otherwise.
