# Destructive Action Approval Gate (Layer 3)

Every destructive attempt against the platform passes through the same
lifecycle. The gate records the attempt; it never executes it.

## Hardening model (revision + fingerprint + TOCTOU)

Each destructive request carries an authoritative integer `revision`
that starts at `1`. Every approval binds to the exact
`(destructiveActionId, revision)` tuple via its full binding metadata
(see below). A **material** change to the request — any field in
`MATERIAL_REQUEST_FIELDS` or `MATERIAL_JUSTIFICATION_FIELDS`
(`contracts/destructive-action.ts`) — forces the revision to
increment and the previous revision's approval row to be marked
`invalidatedAt`. Older approvals are never deleted; they are preserved
in `approvalHistory` but no longer count toward authorization. A
non-material change is a passthrough: `revision` is unchanged.

Fingerprints are **SHA-256** hex digests over canonical JSON (keys
sorted recursively, `undefined` dropped). Two fingerprints:

- **Target fingerprint** covers the material-identity tuple plus
  `revision` (`computeTargetFingerprint`). A later execution that
  claims a different `(action, actionType, projectId,
targetResourceType, targetResourceId, environment, production,
irreversible, revision)` is refused.
- **Policy fingerprint** covers the EFFECT-level shape of the
  decision (`allowed`, `risk`, `requires{Approval,Reauthentication,
Mfa,TwoPersonApproval}`, sorted `matchedPolicyIds`) via
  `computePolicyFingerprint`. Two decisions with the same fingerprint
  are "materially equivalent" even if their reason strings differ.

## Approval binding metadata (equal for primary AND secondary)

Both the primary and the secondary approval records carry the same
authoritative binding metadata on `Approval.decisionMetadata`:

```
kind                      = "destructive_action"
destructiveActionId       = request.id
destructiveActionRevision = request.revision
action, actionType, projectId, targetResourceType,
targetResourceId, environment, production, irreversible,
risk, requesterId, policyFingerprint, correlationId,
role                      = "primary" | "secondary"
```

The executor's TOCTOU guard calls `validateApprovalBinding` which
checks EVERY field — a mismatch on any field refuses execution. A
secondary approval that was created for one request cannot replay
against another, because its `destructiveActionId` and
`policyFingerprint` differ.

## Approver resolver (execution-time re-resolution)

The service accepts a `DestructiveApproverResolver` that re-resolves
historical approver ids against the authoritative operator directory
immediately before execution. The field is typed as **optional** only
so unit tests that never reach `assertApproved(...)` can skip the
wiring; `assertApproved(...)` itself **fails closed** when the
resolver is absent — historical `Approval.decidedBy` metadata is
NEVER accepted as proof of current authorization. A missing resolver
refuses execution with
`destructive execution blocked: authoritative approver revalidation unavailable`
and emits a `destructive_action_execution_blocked` canonical event
with reason `authoritative_approver_revalidation_unavailable`. The resolver must
return `undefined` for any operator that is not currently `active`
and reuses the authoritative `OperatorAccount` / access-control
repository — the service does NOT keep a second identity system.

For every approver counted toward the required threshold:

1. the resolver must return a current principal
2. the principal must hold `approve_destructive_action`
3. the principal must have access to `request.projectId`
4. the principal id must be distinct from `request.requestedBy`
5. the principal id must be distinct from every other counted approver

Any of these failing refuses execution with a precise reason. The
historic `Approval` record is NEVER modified — it stays as audit.

## Policy re-evaluation and strongest-requirement-wins

Immediately before `approved → executing`, the engine is called
again against the authoritative request. Then:

- A `deny` from the current policy refuses execution outright.
- A **stricter** current policy (`policyIsStricter(approved,
current)`) refuses execution and emits
  `destructive_action_reapproval_required` — the executor must call
  `revise(...)` and collect fresh approvals.
- A **weaker** current policy does NOT remove requirements that
  applied at approval time. The effective decision is
  `strongestOf(approved, current)` — reauth, MFA and two-person
  requirements, once set at approval time, persist through
  execution.
- A **materially equivalent** policy (same fingerprint) passes
  without reapproval even if its matched-policy order or reason
  string changed.

## MFA / reauth evidence boundary

The engine returns `requiresReauthentication` / `requiresMfa` on the
effective decision. When set, the executor MUST pass trusted
`SecurityExecutionEvidence` through `assertDestructiveActionApproved`:

```ts
interface SecurityReauthenticationEvidence {
  verified;
  verifiedAt;
  method;
}
interface SecurityMfaEvidence {
  verified;
  verifiedAt;
  method;
}
```

Layer 3 **validates** shape and freshness (`SECURITY_EVIDENCE_FRESHNESS`:
10-minute windows for MFA and reauth). It does NOT verify the
assertion itself — the authoritative verifier is Layer 5. Raw client
flags like `{ verified: true }` must not flow into this field. Stale
or missing evidence refuses execution; the service never pretends
MFA happened.

## TOCTOU execution sequence (`assertDestructiveActionApproved`)

Executed in this exact order. Any failure refuses execution and
emits a `destructive_action_execution_blocked` canonical event:

```
 1. load authoritative request
 2. require status == approved
 3. request not expired
 4. executor holds request_destructive_action
 5. executor has access to request.projectId
 6. target SHA-256 fingerprint matches (includes revision)
 7. resolve active revision row (!invalidatedAt)
 8. re-evaluate current security policy
 9. current policy allowed
10. current policy not stricter (else reapproval_required)
11. effective = strongestOf(approved, current)
12. primary approval binding valid (all metadata)
13. secondary approval binding valid (if effective.requiresTwoPersonApproval)
14. re-resolve every approver via DestructiveApproverResolver
15. approver active + has approve_destructive_action + has project access
16. requester separation of duties
17. unique approvers, count >= required
18. MFA evidence present + fresh (if effective.requiresMfa)
19. reauth evidence present + fresh (if effective.requiresReauthentication)
20. recovery evidence still present (irreversible/production + high/critical)
21. transition approved → executing
```

No destructive I/O may occur before step 21 succeeds.

## Canonical security events

The gate emits (via the optional `DestructiveActionObserver` the
composition root wires to the canonical event store):

- `destructive_action_revision_created`
- `destructive_action_approvals_invalidated`
- `destructive_action_approver_no_longer_authorized`
- `destructive_action_policy_drift_detected`
- `destructive_action_reapproval_required`
- `destructive_action_mfa_required`
- `destructive_action_reauthentication_required`
- `destructive_action_execution_revalidated`
- `destructive_action_execution_blocked`

These extend — not replace — the Layer 4 canonical security-event
taxonomy and use the existing `SECURITY_EVENT_TYPES.DESTRUCTIVE_*`
constants once persisted.

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
