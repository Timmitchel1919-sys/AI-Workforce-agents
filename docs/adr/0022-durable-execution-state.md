# ADR-0022: Durable execution state (EO-4.8)

- Status: Accepted
- Date: 2026-09-24

## Context

Execution sessions, receipts, verifications and release records lived in
memory. The Control Plane runs as up to two Cloud Function instances and
currently rebuilds its runtime per request, so this state was lost
immediately. Cross-instance idempotency and compare-and-swap (CAS)
transitions were also impossible.

## Decision

1. Sessions go into `FirestoreExecutionSessionStore`:
   - every read goes to Firestore;
   - every transition is a transaction that checks the revision;
   - idempotency keys are created atomically with the session.
2. Evidence goes into `ExecutionRecordStore` (`FirestoreExecutionRecordStore`
   in production, `InMemoryExecutionRecordStore` in tests):
   - create-only records with a JSON payload and index fields;
   - all writes are awaited before responding.
3. `DurableLedger` gives the release orchestrators durable records,
   create-only idempotency reservations (taken before the mutation) and
   uniqueness markers.
4. The Functions adapter flushes pending cached-repository writes before
   releasing each response (bounded).

## Consequences

- Execution state survives restarts and is consistent across instances.
  Duplicate protected mutations are prevented by reservation, not by memory.
- Firestore rules are unchanged (deny-all). Only the Admin SDK writes.
- Queries are single-field equality lookups with client-side ordering and
  limits. Composite indexes can replace them if volumes grow.
