# ADR-0008: Canonical security events

## Status

Accepted — Security Foundation V1.

## Decision

Security telemetry has a canonical, provider-neutral event contract named
`CanonicalSecurityEvent`. It is intentionally separate from the existing
SecOps `SecurityEvent` model, which represents the current SecOps domain and
must remain backward compatible.

Canonical events are normalized before persistence, redact credential-shaped
keys and values, require a schema version, and are appended through a store
that rejects duplicate event IDs. Queries are bounded to 100 records and may
be project-scoped.

Existing security-relevant audit events are projected into the canonical shape
for permission decisions, approvals, tool execution, agent activity, and
access events. Canonical event reads are admin-only and a scoped operator must
provide an explicitly allowed project.

Production Firestore now uses a dedicated `FirestoreAppendOnlySecurityEventStore`.
It exposes only `append` and `query`, writes through a transaction's
`create()` operation, and therefore rejects duplicate event IDs without
exposing update or delete methods. The client-facing Firestore rules remain
deny-all; the adapter protects the trusted server-side composition boundary.

## Consequences

- Permission, approval, policy, authentication, and agent-security events can
  converge on one redacted shape without coupling core code to Firebase.
- Project scoping is explicit and cannot be inferred from free text.
- The generic repository remains available for unrelated mutable domains, but
  it is not used for canonical security events in the production composition.
- Existing audit and SecOps records remain compatible and can be migrated by a
  later adapter rather than by changing their public contracts.
