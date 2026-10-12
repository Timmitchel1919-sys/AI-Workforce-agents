# Destructive Action Approval Gate (Layer 3)

Every destructive attempt against the platform passes through the same
lifecycle. The gate records the attempt; it never executes it.

## Lifecycle

```
requested ─▶ awaiting_approval ─▶ approved ─▶ executing ─▶ executed
                 │                   │           │
                 ├─ changes_requested │           └─▶ failed
                 ├─ rejected          └─ expired
                 └─ cancelled
```

- `requested` — created when the policy did NOT require approval
  (vanishingly rare; the engine forces approval for any inherently
  destructive action).
- `awaiting_approval` — created in every normal destructive request.
- `approved` — all required approvers have decided `approve`.
- `executing` — set by `assertDestructiveActionApproved(...)` and ONLY
  then. The transition is the authorization gate for the executor.
- `executed` — set by `markExecuted(...)` after the executor verified
  the real-world result.
- `failed` — set by `markFailed(...)` when the executor could not
  complete.

Terminal statuses (`executed`, `failed`, `rejected`, `cancelled`,
`expired`) cannot transition further.

## Structured justification

A request is **rejected** before approval if the justification is
incomplete. Required fields:
`summary`, `reason`, `blockerOrHindrance`, `expectedImpact`,
`selectedAlternativeReason`, `recoveryPlan`, `dataRetentionImpact`,
`complianceImpact`, `saferAlternatives` (at least one), and the
booleans `reversible`, `backupAvailable`, `rollbackAvailable`.

For `irreversible || production` requests at `high` / `critical` risk,
the service additionally requires `backupAvailable || rollbackAvailable`
to be true. Executor-provided fields are the trusted ones — raw client
`backupAvailable: true` is **not** validated here; backup verification
is a future integration.

## Safer alternatives

Enumerated: `archive`, `disable`, `quarantine`, `deprecate`, `unlink`,
`migrate`, `rollback`, `soft_delete`, `retain`, `none`. Permanent
deletion is **never** the default recommendation.

## Approval binding and separation of duties

Each request creates a single primary approval tied to the exact
`(destructiveActionId, actionType, targetResourceType, targetResourceId,
projectId, environment, risk, correlationId)`. Replay against a
different target fails: approval ids cannot be reused.

- The requester **cannot** approve their own destructive action (SoD).
- When `policyDecision.requiresTwoPersonApproval` is true, a second
  approval record is created on the first approve decision. The second
  approver **must** be distinct from the first — the service throws
  `distinct second approver` otherwise. The service never collapses
  two-person into one-person approval.

## Reauth / MFA

The engine returns `requiresReauthentication` / `requiresMfa` on the
decision. The service **honors** these fields by requiring the policy
decision as-is on each precondition revalidation. Verification of the
reauth / MFA assertion itself is a Layer-5 responsibility; if the
runtime cannot verify, the gate **blocks**. The service never pretends
MFA happened.

## TOCTOU execution guard

Executors call `assertDestructiveActionApproved(service, input)`
immediately before the real I/O. The guard refuses when:

- the request is not in `approved` status;
- the executor lacks `request_destructive_action` or project access;
- the pinned `(actionType, targetResourceType, targetResourceId,
environment, projectId)` tuple does not match the stored hash — the
  target drifted since approval, reapproval required;
- the primary approval is not in `approved` status;
- the secondary approval is required but not approved, or shares an
  approver with the primary;
- the approval has expired.

Only on all preconditions passing does the record transition to
`executing`. `markExecuted(...)` or `markFailed(...)` records the
verified outcome; the service does not infer success.

## Prohibited deletion targets

The following destructive requests are **denied by the policy engine**
and never reach the service:
`audit.history.delete`, `security_event.history.delete`,
`secret.export.raw`, `security_policy.bypass`. Retention and archival
are a separate lifecycle, not a destructive-action.

## Known limitations

- Policy history for the request's justification is stored as an
  append-only `history` array on the record. There is no separate
  policy-decision history store yet.
- Agent-initiated destructive requests are modeled (`actorType`
  supports `agent`) but no executor currently calls `request(...)` from
  an agent context. The service rejects agent-initiated requests from
  approving the same request.
- Repository-persisted approvals / destructive records use the
  in-memory stores in Layer 3; the durable Firestore adapter is the
  next integration.
- Not every destructive path in the codebase currently calls
  `assertDestructiveActionApproved`. The guard is **available**;
  wiring it into each legacy destructive executor is tracked for Layer
  5 integration. Known un-guarded destructive paths at the time of
  writing include: project / repository / integration deletion
  endpoints, agent disable/enable in bulk flows, and secret-reference
  deletion.
