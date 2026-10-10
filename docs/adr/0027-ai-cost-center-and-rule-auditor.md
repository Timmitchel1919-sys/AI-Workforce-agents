# ADR-0027: AI Cost Center & rule-based Auditor governance foundation (EO-6.2)

- Status: Accepted
- Date: 2026-09-27

## Context

Onboarding already lets an operator record a per-project `CostPolicy`
(`contracts/onboarding.ts`) — a daily/monthly/task limit, a warning threshold,
a hard-stop flag — and says so honestly in its own governance gap list:
"Budget policies are recorded but not enforced: no AI Cost Center is wired."
Production also registers zero model providers (`core/providers/*` exists but
was never composed into `api/production-control-plane.ts`), and there is no
AI Auditor of any kind. EO-6.1 wired the release pipeline; this layer is next
in dependency order because autonomy without cost visibility or a governance
check is the wrong direction to build in.

## Decision

### AI Cost Center: a real ledger and a real gate, no fabricated capability

`core/cost-center/` adds:

- **`UsageLedger`** — durable, project-scoped model-usage records
  (`DurableLedger`, the same primitive EO-4.8 release records use). An entry
  is written only from a real `ModelResponse`'s own reported token counts —
  never assumed.
- **A price table** (`contracts/cost-center.ts`, `estimateCost`) — an
  explicit, versioned, hand-maintained USD-per-million-token table for a
  short list of named models. A model with no entry, or a response with no
  reported usage, is **honestly unpriced** (`priced: false, reason: …`) —
  never a guessed number, and never silently treated as zero cost.
- **`BudgetPolicyStore`** — a project's _enforced_ limit, distinct from
  onboarding's `CostPolicy` (a planning document). Setting one is
  administrator-only (`manage_budget_policy`, a new `ControlCapability`) and
  audited (`budget_policy_set`). Onboarding's policy is **not** automatically
  adopted here — recording it still enforces nothing, so onboarding's gap
  note stays true until an explicit future layer bridges the two.
- **`evaluateBudget`** (pure) — combines a policy with windowed USD totals
  into `not_configured | ok | warning | blocked | unpriced`. No policy is
  **not** the same as an unlimited budget (`NOT_CONFIGURED != unlimited`); a
  reached hard-stop limit blocks, a reached soft limit only warns; unpriced
  usage in scope is reported rather than silently ignored.
- **`BudgetGovernedModelProvider`** — a `ModelProvider` decorator that calls
  `BudgetEnforcer.evaluateInternal` **before** the inner provider, throws
  `ExecutionDeniedError("RESOURCE_LIMIT", …)` on a block (the inner call never
  happens, nothing is recorded), and on success records real usage from the
  response. Composed _inside_ `AuditedModelProvider` so a denial is still an
  audited `model_execution_failed`. A request with no `projectId` in its
  metadata is refused outright — never silently ungoverned.
- **Two authorization paths, deliberately** — `BudgetPolicyStore.get`/`set`
  and `UsageLedger.listByProject`/`totals` take an `OperatorPrincipal` and
  authorize normally (an HTTP read). `getInternal`/`listInternal`/
  `totalsInternal` and `BudgetEnforcer.evaluateInternal` take none: the
  preflight gate a model call runs through is the platform's own trusted
  internal path, not an operator viewing a project, and does not fabricate an
  "admin, allow-all" principal to force itself through the operator-facing
  check.

**Production registers zero model providers.** `ModelProviderRegistry` is
composed empty; nothing calls a model, so nothing is ever recorded and the
gate is never exercised. This is not simulated as "working" — it is reported
honestly as `enforcement: false`.

### AI Auditor: RULE-BASED, not model-assisted

`RuleAuditor.run(projectId, inputs)` is pure and synchronous: a fixed table of
four deterministic rules over records already fetched through the same
authorized, project-scoped reads the Spatial Graph and Operations use
(`release_without_verification`, `release_without_approval`,
`high_risk_session_unapproved`, `usage_unpriced`). **No model call is ever
made to produce a finding.** A future model-assisted auditor is a distinct
capability this module does not claim — the name "AI Auditor" describes the
governed subject matter, not the judging technology. A simulated release
(`ReleaseReceipt.simulated`) is never audited as a real deployment
(VISUALIZATION != EXECUTION, ADR-0023). Findings are recomputed fresh on every
read rather than persisted, so a fixed problem cannot linger as stale
evidence the way a stored-and-forgotten record would.

### Wiring and honesty at the read surface

`ControlPlaneContext` gains `costCenter` (usage + budget policy + enforcer,
always composed — none of it needs a model provider to exist),
`costCenterCapabilities` (derived at read time from the live
`ModelProviderRegistry`, the same "connected vs capable" shape as
`ReleaseCapabilities`), and `auditor`. `GET /api/projects/:id/cost` and
`GET /api/projects/:id/audit-findings` are new, project-isolated, read-only
routes. `deriveCostCenterCapabilities` returns getters, not a snapshot: a
provider registered after the capabilities object was created is still
reflected live (mutation-tested).

## Known gaps (honest, not hidden)

- **No HTTP write endpoint for `BudgetPolicyStore.set`.** It is real, tested,
  admin-gated and audited, and reachable from a trusted host or a test —
  just not yet from a Control Plane command. Exposing it needs the same
  `ControlCommandResult`/audit-correlation plumbing every other command uses,
  which is a bounded follow-up, not a design gap.
- **The rule auditor can only see what it is given.** If a release exists
  while the verification or source-control read for the same project is
  itself unwired (a capability drift this deployment cannot reach today,
  since all three currently share the same "no adapter" state), a finding
  would read "no matching verification found" rather than distinguishing
  "verified but the record is unreachable" from "never verified". Not
  reachable in production as composed.
- **The price table lists a handful of named models.** Anything else is
  honestly unpriced, not silently free and not guessed.
- Onboarding's `CostPolicy.enforcement` field still correctly reads
  `"not_enforced"` — bridging it to `BudgetPolicyStore` automatically is
  explicitly deferred, not attempted here.
