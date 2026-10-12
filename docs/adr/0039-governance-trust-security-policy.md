# ADR-0039: Governance, Trust, Security & Policy Intelligence

## Status

Accepted

## Context

Layers 1–6 each carried local guards (deny-by-default grants, tool policy, command
policy, path guard, approvals, a cost-governance engine), but there was no single place that
answered *who / what / which resource / which environment / how risky / which policy / approval?*
before an action ran. The platform stays private and single-user: only project isolation
applies; no tenancy, billing, SSO or customer RBAC.

## Audit — reused, not duplicated

| Existing | Use |
| --- | --- |
| `ApprovalSystem` | Stays the single record of a decision. Governance approvals are views + a fingerprint/single-use/cancel overlay on it, so the old Approvals page and the Trust Center agree |
| `AuditLog` | Governance events are mirrored as `governance_event`; independent auditor findings use `audit_finding_raised` |
| Layer 5 `RUNTIME_TOOLS`, command policy, path guard, scope evaluation | Tool trust catalog is built from them; their refusals feed the threat detector |
| `GovernancePolicyEngine` (cost / model allow-list) | Untouched; budget governance is a different concern |
| `agentOps` enable switch | Maps to the DISABLED trust state |
| `secret-scan` | Secret detection / redaction everywhere |
| Layer 3 `ContextSource` | Governance briefing for the Prompt Engineer |
| Layer 4 orchestrator | New optional `TaskGovernancePort` (same pattern as the cost gate) |
| Legacy `secops`, `risk`, `trust` services | Organization-scoped (multi-tenant) and not wired — not extended |

## Decision

`SecurityGovernor` (`core/security-governance/`) is the one policy decision point, deterministic
and fail-closed (a malformed request or an internal error is a DENY):

```
identity → emergency stop → agent trust → project isolation → tool trust → model/data trust
 → permission (least privilege) → resource & data class → risk → policy → trust modifiers
 → approval → audit → threat feed
```

- **Risk engine**: explainable points (action, resource kind, environment, bulk size, blast
  radius, irreversibility, data sensitivity, agent trust) → LOW/MEDIUM/HIGH/CRITICAL. Calibrated to
  the specified examples (edit CSS LOW; auth logic HIGH; prod deploy HIGH; delete production DB
  CRITICAL; 3,000 files HIGH …) and covered by tests.
- **Policy engine**: 14 immutable built-in system policies + user policies in layers
  (system → project security → architecture → workflow → task → agent → user request). Effects
  merge by restrictiveness, so a lower layer can only *add* restrictions; `ALLOW` policies are
  refused as meaningless; critical policies need an administrator.
- **Permission engine**: least privilege by task type, plus: sensitive resources (security rules,
  auth code, CI/deploy config, database, infrastructure) may be written only when the task
  declared them. Cross-project use is denied.
- **Baseline by risk**: HIGH/CRITICAL are never auto-approved; an agent's claim of safety changes
  nothing. Approvals are bound to the exact action (fingerprint), single-use, expiring (24 h),
  decided only by a human with `approve` rights (CRITICAL: administrator + written reason).
- **Enforcement points**: runtime tool session (every read, write, delete, command, commit,
  deployment hand-off); orchestrator (before a task starts, fail-closed); model gateway (secrets in
  prompts blocked, data class vs. model maximum, output redaction); Layer 3 context source.
- **Trust**: agent states TRUSTED / LIMITED / REVIEW_REQUIRED / SUSPENDED / DISABLED (restoring is
  admin-only; repeated refusals auto-suspend and cancel live sessions); model trust (external
  providers cap the data class; RESTRICTED/SECRET never leave); tool trust (unknown tools denied).
- **Alerts & threat detection**: lifecycle OPEN → ACKNOWLEDGED → INVESTIGATING → RESOLVED /
  FALSE_POSITIVE; HIGH/CRITICAL can be closed only by an administrator with a note; rule-based
  detection of repeated refusals, secret access, privilege escalation, destructive-request bursts,
  blocked commands, abnormal sensitive reads.
- **Emergency stop**: durable global brake (PAUSED → INVESTIGATING → RECOVERY_REQUIRED → NORMAL);
  blocks the governor, orchestrator and model gateway, cancels live sessions; resume is
  administrator-only from RECOVERY_REQUIRED with a note, never automatic.
- **Audit**: hash-chained append-only ledger (`verify()` detects edits/removals; the repository
  wrapper refuses overwrite/delete); an independent `GovernanceAuditor`; drift detection compares
  declared vs. actual changes after execution and forces the review verdict to `changes_requested`.
- **Monitoring**: security-config baseline (rules, firebase.json, workflows …), `npm audit`
  parsing, operational trust score (derived from measured signals, with an explicit disclaimer),
  security dashboard.

## Known gaps (reported, not hidden)

- **No outbound-network detection**: the runner does not observe connections.
- **Security review** is enforced as a human approval at runtime; the Layer 4 router does not yet
  add a security-agent gate automatically for security-rules tasks.
- **Dependency scanning** needs a registered local workspace (production has none) and network
  access; nothing is ever auto-upgraded.
- **Data classification** is path/content-pattern based (no ML classifier); only prompts that show
  file paths in `<file path="…">` blocks are classified by path.
- AI is not used for authorization; there is no anomaly-detection model.
- Model-level policy covers the agent loop and the specialist agents' routed providers; other
  providers added later must be wrapped with `governedModel`.
- Orchestrator-level approvals taken in the old Approvals page are not recorded in the governance
  ledger unless they go through the Trust Center (the decision itself is the same record).
