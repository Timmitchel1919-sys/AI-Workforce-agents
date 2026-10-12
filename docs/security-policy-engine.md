# Security Policy Engine (Layer 2)

Deterministic enforcement layer that answers one question: **"May this
attempt this action here?"** Pure function of its inputs, no I/O, no
LLM, no state mutation.

## Relationship to the Governance Policy Engine

The repository already ships
`core/cost-center/governance-policy-engine.ts`. It is **preserved**.
The two engines answer **different** questions and both run before any
sensitive action proceeds:

| Engine                   | Scope                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Governance Policy Engine | cost, model/provider allow-list, budget                                               |
| Security Policy Engine   | risk, destructive actions, identity/security controls, irreversible production impact |

A `deny` from **either** engine is final. The API layer composes them
in order: `Capability check → Project scope → Governance → Security →
Approval → Executor`.

## Risk levels

`low` < `medium` < `high` < `critical`. Combining decisions always
keeps the highest observed risk — the engine never silently downgrades
a decision.

## Default policies

Shipped in `defaultSecurityPolicies()`. Priority is a lower-first
integer; smaller numbers evaluate first and shape the base decision.

| Id                              | Scope                                                         | Risk     | Effect           | Extra                   |
| ------------------------------- | ------------------------------------------------------------- | -------- | ---------------- | ----------------------- |
| `sec.h.destructive-prod`        | permanent/delete/destroy/purge in **production**              | critical | require_approval | reauth, MFA, two-person |
| `sec.h.destructive`             | permanent/delete/destroy/purge/revoke/terminate/drop          | high     | require_approval | reauth                  |
| `sec.d.security-policy-change`  | `security_policy.*`                                           | high     | require_approval | reauth, MFA             |
| `sec.f.secret-reference-change` | `secret.reference.*`, `secret.metadata.*`                     | high     | require_approval | reauth                  |
| `sec.e.identity-change`         | `operator.role.*`, `operator.access.*`, `identity.security.*` | high     | require_approval | reauth                  |
| `sec.g.agent-security-change`   | `agent.security.*`, `agent.privilege.*`                       | high     | require_approval | reauth                  |
| `sec.c.production-deployment`   | `deploy_release`, `release.*` in production                   | high     | require_approval | reauth                  |
| `sec.a.read.allow`              | `read.*`, `list.*`, `describe.*`                              | low      | allow            | —                       |
| `sec.b.standard-mutation.allow` | `write.*`, `update.*`, `create.*`, `upsert.*`                 | medium   | allow            | —                       |

## Precedence (strongest wins)

1. **Prohibited invariants.** `audit.*.delete`, `security_event.*.delete`,
   `secret.export.raw`, `secret.read.raw`, `security_policy.bypass` are
   permanently `deny` with risk `critical`. No `SecurityPolicy` may
   override — the invariant check runs before policy lookup.
2. **Explicit `deny`** on any applicable policy.
3. **Explicit `require_approval`** on any applicable policy; reauth / MFA
   / two-person requirements are **accumulated** across all matched
   policies and can never be cleared by a later `allow`.
4. **Risk ceiling.** The decision carries the max risk of any match.
5. **Inherently-destructive unknown.** If no policy matched but the
   action starts with `delete.`, `destroy.`, `purge.`, `revoke.`,
   `terminate.`, `drop.`, `permanent.`, `wipe.`, or `context.destructive`
   is true, the engine fails **closed** to `require_approval` at
   `high` (or `critical` when `irreversible && production`), with
   reauth and (for `critical`) two-person.
6. **Unknown non-sensitive action.** No policy matched and nothing looked
   destructive → DENY with reason `SECURITY_POLICY_UNKNOWN`. The caller
   must define an explicit `allow` policy.

## Fail-closed behavior

- Prohibited action → `deny critical`.
- Unknown non-sensitive action → `deny medium`.
- Unknown destructive action → `require_approval high|critical`.
- Policy mutation requires `manage_security_policy` AND must itself be
  evaluated by this engine (no self-bypass).

## Capability integration (Layer 1)

The engine does **not** check capabilities; the API layer does, before
calling the engine. The capabilities relevant to this layer:

| Action                     | Capability                   | Also required by engine                          |
| -------------------------- | ---------------------------- | ------------------------------------------------ |
| View policy posture        | `view_security`              | —                                                |
| Mutate security policy     | `manage_security_policy`     | engine returns `require_approval` + reauth + MFA |
| Request destructive action | `request_destructive_action` | engine returns `require_approval`                |
| Approve destructive action | `approve_destructive_action` | engine returns `require_approval`                |

## Limitations (deferred, intentional)

- Repository-backed `SecurityPolicyService` for CRUD on policies is
  **not** shipped in this layer — the in-memory default-policy seed
  covers the Layer-2 contract, and mutation goes through a future
  governed route.
- The engine does **not** emit `security_policy_evaluated` canonical
  events on its own; the caller emits the event with the decision it
  received, binding `policyId` and `correlationId` so audit and query
  stay cheap.
- MFA / reauth verification itself is a Layer-5 (API Security
  Middleware) concern. The engine **requires** them in the decision;
  it never pretends they were satisfied.
