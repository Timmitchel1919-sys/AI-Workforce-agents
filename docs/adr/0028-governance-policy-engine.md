# ADR-0028: Governance Policy Engine, and closing EO-6.2's deferred gaps (EO-6.3)

- Status: Accepted
- Date: 2026-09-27

## Context

ADR-0027 (EO-6.2) built the AI Cost Center's ledger, price table and budget
gate, and a rule-based Auditor, and named three deliberate gaps: no HTTP
write path for the budget policy, onboarding's `CostPolicy` was never bridged
into real enforcement, and the Auditor could not yet distinguish "not
connected" from "proven violation". This layer closes all three, and adds
the Governance Policy Engine the wider masterprompt asked for: one
structured `allow / deny / require_approval / unknown` decision composing
project authorization, the budget gate, and an optional provider/model
allow-list — reusing the existing `ApprovalSystem`, never a second one.

## Decision

### Governance Policy Engine (`core/cost-center/governance-policy-engine.ts`)

`GovernancePolicyEngine.evaluate(principal, request)` composes, in order:
project access (`operatorCanAccessProject`, fail-fast), the budget gate
(`BudgetEnforcer.evaluate`, reusing EO-6.2's evaluation, never re-implemented),
an optional per-project provider/model allow-list
(`GovernancePolicyStore`, admin-gated, mirrors `BudgetPolicyStore`), and an
approval threshold. `unknown` is a first-class outcome: a request with no
cost estimate and a policy that does not explicitly allow unknown cost comes
back `unknown/UNKNOWN_COST_NOT_ALLOWED` — never silently `allow` (as if free)
and never `deny` (a policy that was never actually asked). Any _unexpected_
internal failure — a thrown error, not a normal decision — is caught and
returned as `unknown/GOVERNANCE_UNAVAILABLE`; the engine never defaults to
`allow` because it could not finish evaluating (mutation-tested).

`require_approval` files a REAL approval on the existing `ApprovalSystem`
through a new bound-action namespace (`governance.cost_override`), following
the exact pattern `core/release/approval-binding.ts` established for release
actions: the approval is bound to `(action, projectId, requestId)` and a
stale, wrong-project, rejected or expired one authorizes nothing. Calling
`evaluate` again with the same `requestId` and the approval id it returned
does not spam a duplicate approval: a still-pending one is reported again
unchanged, and only a dead one (rejected/expired/missing) is replaced.

A `GovernanceRequest`'s `estimatedUsd` is validated at TWO boundaries — the
HTTP command (`validateGovernanceRequest`) and the engine itself — because a
`NaN` estimate would otherwise silently pass every `> threshold` comparison
(`NaN > x` is always `false`) while still counting as "cost is known",
bypassing the approval requirement entirely. Rejected outright at both
boundaries.

### Money correctness (`contracts/cost-center.ts`, `sumUsd`)

Plain `+=` over many small USD amounts drifts: ten `$0.01` charges sum to
`0.09999999999999999` in IEEE-754, not `$0.10` — a real bug class, not a
hypothetical (demonstrated in `tests/cost-center.test.ts`). `UsageLedger`'s
aggregation now uses Kahan compensated summation (`sumUsd`), which is exact
for this class of drift; per-event cost keeps whatever sub-cent precision the
price table computed (rounding at the event level would silently lose real
sub-cent cost, which is worse). Full migration to integer minor units was
considered and deferred — it would touch every already-shipped EO-6.2
contract and is disproportionate to the actual bug, which is a summation
technique, not a representation one.

### Idempotent usage recording (`UsageLedger.record`)

A caller-supplied `idempotencyKey` makes `record()` idempotent: a retried
call with the same key returns the FIRST record unchanged (never
double-charges a project for one retried provider call), safe under
concurrency (the store-backed path's create-only semantics mean two
instances racing on the same key can never both win). With no key, no dedupe
is attempted — never silently assumed safe.

### AI Auditor: UNKNOWN != VIOLATION (`core/cost-center/rule-auditor.ts`)

`release_without_verification` now takes `sourcesConnected: {verification,
sourceControl}`. When this deployment never composed those capabilities, the
rule raises NOTHING for a release with no matching verification — a
capability that was never connected cannot have recorded evidence either
way, so reporting a bypass would punish "not connected" as if it were
"proven violated" (the exact failure mode ADR item 26 of the masterprompt
named). Not reachable in today's production composition (verification,
source control and deployment adapters are all absent together per
ADR-0026), but a real correctness fix for the moment any one of them is
wired independently of the others.

### HTTP command surface (closing EO-6.2's deferred gap)

`WorkforceCommandService` gained three commands, dispatched the same way
every other command is (`POST /api/commands/<kind>`, `ControlCommand` union,
audited via the existing `audited()` helper — never a bespoke path):
`set-budget-policy`, `set-governance-policy` (both admin-only, delegate to
the stores' own self-authorization too — belt and suspenders), and
`evaluate-governance` (available to any principal who can view the project;
a `require_approval` outcome only ever FILES a pending approval, it never
executes anything). New read routes: `GET /api/projects/:id/governance-policy`
alongside EO-6.2's `/cost` and `/audit-findings`.

### Onboarding bridge (closing EO-6.2's deferred gap)

`OnboardingControlService.onboardingApprovePlan` now bridges an approved
plan's `CostPolicy` into a REAL `BudgetPolicy`, when — and only when — the
plan actually configured a limit (never a fabricated default policy for an
unconfigured project). The bridge is best-effort: a thrown error inside it
is caught and never undoes the onboarding approval that already succeeded
(the same "PROJECT READY != AUTOMATIC EXECUTION" honesty extended to
"a budget-bridge hiccup must not block onboarding"). Onboarding's own
`CostPolicy.enforcement` field still correctly reads `"not_enforced"` — that
field describes the PLAN, not this platform's separate enforcement record,
and the two are intentionally not conflated.

### What was explicitly NOT done, and why

- **Spatial Graph integration** (cost/budget/finding nodes) is deferred. It
  touches `contracts/graph.ts`, the execution-fragment builder, revision
  hashing, and the UI graph/inspector — a large, separate change to an
  already-reviewed subsystem. Adding it under this layer's time budget risked
  either a shallow, decorative integration (explicitly warned against) or an
  under-tested one; neither is acceptable for a subsystem this sensitive.
- **A real Model Router** does not exist and this layer does not build one.
  `core/planning/model-capability-registry.ts`'s `modelPolicy` remains
  exactly what its own file comment says: a DECLARED, provider-neutral
  eligibility check agents carry for planning, with zero dynamic selection,
  zero cost-awareness and zero runtime routing. It must not be described as
  a Model Router.
- **A write UI** for the budget/governance policy is deferred; the API
  exists (admin-gated, audited) but the read-only display is what this
  layer's UI covers.

### Fixed from independent review

Two parallel fresh-context reviews (security, correctness) found zero
BLOCKER/CRITICAL and four MAJOR issues, all fixed here with mutation-checked
tests:

- **Model allow-list case sensitivity** (`GovernancePolicyEngine.decide`).
  `validateGovernancePolicyDraft` stores `allowedModels` lowercase, exactly
  like `allowedProviders`, but the model comparison forgot to lowercase the
  request side — an admin who allow-listed `"Claude-Sonnet-5"` would see a
  request for the identical model wrongly denied by case alone. Fixed to
  match the provider comparison; the test that claimed to cover this
  ("...or model... case-insensitive") never actually exercised
  `allowedModels` — replaced with one that does.
- **No-store idempotency race** (`UsageLedger.record`). The store-backed
  path is safe under concurrency (`RecordExistsError`), but the in-memory
  fallback `DurableLedger` uses when no store is configured has no
  create-only protection at all — two genuinely concurrent calls with the
  same idempotency key could both "win", with whichever write landed last
  silently overwriting the other's content. `UsageLedger` now coalesces
  concurrent calls for the same key onto ONE in-flight promise, reserved
  synchronously before any `await`, closing the race without changing the
  shared `DurableLedger` primitive itself.
- **Idempotency-key/projectId delimiter collision.** The storage id joined
  `projectId` and the caller's `idempotencyKey` with `:`, a character
  `projectId` may legally contain — project `"acme"` with key `"eu:x"` and
  project `"acme:eu"` with key `"x"` produced the identical id. Fixed to
  validate the key (`requireExecutionId`) and join with `\u0000`, which
  neither field can contain.
- **Audit-trail gap on a malformed `evaluate-governance` request.**
  `validateGovernanceRequest` validated `projectId`/`requestId` more loosely
  than the engine's own internal re-check, so a value that passed the
  command's validation but failed the engine's could throw past
  `evaluateGovernance`'s `audited()` call, skipping the audit trail for that
  rejection. Fixed by matching validation strictness at the boundary, and
  by wrapping the engine call in the same try/catch pattern every other
  command in this file already uses.

## Consequences

- Production still registers zero model providers, so
  `costCenterCapabilities.enforcement` stays honestly `false`; the Governance
  Policy Engine and the budget gate are real and tested but structurally
  cannot see a real call yet.
- The Auditor's `sourcesConnected` guard means a future adapter that wires
  ONE of verification/source-control/deployment independently of the others
  will not produce a false "bypass proven" finding — this was verified with
  a dedicated test, not left to be discovered later.
- Approving an onboarding plan with a real budget limit now has an
  observable side effect beyond the plan record itself (a `BudgetPolicy` is
  set) — audited, admin-scoped, and reported in ADR form here rather than
  left implicit.
