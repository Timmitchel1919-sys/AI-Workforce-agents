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

The repository-backed store is an adapter seam. The current generic repository
still exposes mutation methods, so production Firestore immutability requires
the next persistence hardening step: a write-only event collection or Firestore
rules/adapter that rejects update and delete operations.

## Consequences

- Permission, approval, policy, authentication, and agent-security events can
  converge on one redacted shape without coupling core code to Firebase.
- Project scoping is explicit and cannot be inferred from free text.
- The current store prevents duplicate appends but cannot by itself prevent a
  privileged repository implementation from deleting records.
- Existing audit and SecOps records remain compatible and can be migrated by a
  later adapter rather than by changing their public contracts.
