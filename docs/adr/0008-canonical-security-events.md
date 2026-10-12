# ADR-0008: Canonical security events

## Status

Accepted — Security Foundation V1 (amended for Layer 4 expansion).

## Amendment — Layer 4 (2026-10-12)

The canonical model is **extended, not replaced**. The authoritative
contract remains `CanonicalSecurityEvent` in `contracts/security-event.ts`.

- **Categories** add: `access_control`, `destructive_action`,
  `api_security`, `secrets`, `deployment`, `data_access`,
  `configuration`, `incident`, `vulnerability`, `integrity`,
  `availability`, `prompt_injection`, `external_content`,
  `integration`. The legacy `data_protection` is **preserved** for
  backward compatibility; new code should prefer `data_access`.
- **Outcomes** add: `succeeded`, `pending`, `escalated`, `contained`.
  Legacy outcomes are never renamed.
- **Actor kinds** are standardized as
  `human | agent | service | system | integration | unknown`. The
  runtime still accepts `string` for stored events; new emitters must
  use one of the standard values.
- **Event type catalog** (`SECURITY_EVENT_TYPES`) documents the
  well-known types each subsystem emits — authentication, authorization,
  access, policy, destructive, agent, secrets, deployment, API,
  prompt/external content. Subsystems may continue to emit other types.
- **Redaction** is strengthened: an exact-match allowlist of secret
  key names (`password`, `access_token`, `authorization`, `cookie`,
  `private_key`, `service_account_key`, `client_secret`, `api_key`,
  `webhook_secret`, `credential`, `secret`, `id_token`,
  `session_token`, `refresh_token`) replaces whole values; token-shaped
  patterns (`sk-…`, `Bearer …`, `ghp_…`, `AIza…`, PEM blocks) are
  scrubbed inside strings. Evidence payloads are now bounded —
  `maxDepth=6`, `maxArrayItems=64`, `maxStringLength=2048`,
  `maxEvidenceKeys=64` — with truncation markers rather than refusal.
- **Query** adds `type`, `actorId`, `agentId`, `correlationId`,
  `approvalId`, `destructiveActionId`, `incidentId`, `targetId`.
  `limit` remains clamped to `[1, 100]`.
- **Integrity chaining.** `previousEventHash` / `eventHash` remain
  **optional** fields on the contract. A reliable chain requires
  transaction-safe per-stream ordering that the current Firestore
  adapter cannot cheaply guarantee across projects, so a global chain
  is **deliberately not** implemented in Layer 4 and tamper-evidence
  is **not** claimed. A per-project chain is viable as a follow-up on
  top of the existing append-only transaction.create() semantics.
- **Append-only** is unchanged: the store exposes only `append` and
  `query`. There is no `update`, `delete`, `set`, `clear` or `remove`
  surface. The Firestore client rules remain deny-all. The engine's
  `isProhibitedAction` guard makes any attempt to invoke a deletion
  path return `deny critical` before the service ever runs.
- **Authorization** now uses the Layer-1 capabilities: high-level
  posture → `view_security`, detailed canonical events →
  `view_security_events`. Project scope stays mandatory; an admin
  with explicit project scope cannot read other projects' events, and
  a scoped operator without a `projectId` query returns no data.
- **Operational AuditEvent vs CanonicalSecurityEvent.** The operational
  `AuditEvent` log is the authoritative action history; it is projected
  into the canonical security stream via `projectAuditEvent` for
  permission decisions, approvals, access events, tool execution and
  agent activity. There is one authoritative history (operational
  audit) and one normalized projection (canonical security events).

## Decision

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
