# ADR-0029: Model Routing & Intelligent Execution Selection (EO-7)

- Status: Accepted
- Date: 2026-09-27

## Context

Preflight for this layer found something ADR-0027/0028 had not: production
already has a REAL, wired, potentially-billable model call path —
`agents/control-plane-analysis/openai-agent-executor.ts`'s
`CONTROL_PLANE_ANALYSIS_AGENT` (`allowedProjects: ["money-mind"]`), bound to
a real `OpenAIModelProvider` via `createProductionOpenAIAgentExecutor`. It
was never registered in `ModelProviderRegistry`, never routed, never
recorded into the Cost Center, and never audited by anything the EO-6.2/6.3
governance layer built. "Production registers zero model providers" — the
honest claim ADR-0027/0028 made — was true of the registry, but not of the
whole system. This layer's first, and most concrete, job is closing that
gap, alongside building the Model Router the masterprompt asked for.

## Decision

### Reused, not reinvented

- **Capability taxonomy**: `ModelCapability`/`ModelCapabilityProfile` from
  `contracts/planning.ts` (EO-3.1) — the SAME vocabulary planning-time
  eligibility already used. No parallel taxonomy.
- **Provider registry**: `ModelProviderRegistry` (EO-6.2), previously
  composed empty. Now genuinely registers `"openai"` — the ONE real
  provider this deployment has. `costCenterCapabilities.enforcement`
  correctly flips to `true`: there is a real, governable call path now,
  independent of whether `OPENAI_API_KEY`/`OPENAI_MODEL` happen to be
  configured (the provider adapter still fails closed if they are not —
  AVAILABLE (a factory is registered) != CONFIGURED (it can actually reach
  OpenAI); this layer only ever claims the former).
- **Governance**: `GovernancePolicyEngine`/`BudgetEnforcer` (EO-6.3) decide
  every candidate's fate. The Router adds no second policy or cost system.

### The Model Router (`core/routing/model-router.ts`)

One pipeline: capability filter (via `ModelCapabilityRegistry.eligibility`,
respecting the agent's own `modelPolicy` — MODEL POLICY != ROUTING DECISION,
but it is a real input) → provider availability (`ModelProviderRegistry.has`)
→ per-candidate governance (deny/require_approval/unknown, never
pre-filtered out of the persisted record) → multi-factor ranking → a
persisted, reconstructable `RoutingDecision` (`DurableLedger`, same
primitive as EO-4.8/6.2/6.3). Filtering and ranking are separate: a denied
candidate is never ranked regardless of score.

Two entry points, one shared pipeline (`evaluate`, private):

- `route(principal, request)` — operator-facing, delegates to
  `GovernancePolicyEngine.evaluate` (principal-authorized).
- `routeInternal(request)` — the trusted path an agent's OWN execution
  takes. No operator principal exists there, the same reason
  `BudgetGovernedModelProvider` uses `BudgetEnforcer.evaluateInternal`
  rather than fabricating an "admin, allow-all" principal. It re-implements
  the SAME allow-list/threshold/unknown-cost logic against the stores'
  existing internal, unauthorized methods
  (`BudgetEnforcer.evaluateInternal`, `GovernancePolicyStore.getInternal`)
  — duplicated deliberately rather than refactoring the already-reviewed
  `GovernancePolicyEngine`, and re-validated for NaN/Infinity independently
  (the same bypass class EO-6.3 fixed once already).

**Selection** (never "always the strongest model"): `cost_efficient` ranks
by the SAME price table the Cost Center uses; `quality_first`/
`high_assurance` rank by how many of the requirement's PREFERRED (not
required) capabilities a candidate satisfies — a real, if weak, signal, not
a fabricated quality score; `low_latency`/`balanced`/no profile fall back to
a deterministic id order, documented as exactly that rather than faking a
latency number. The final tie-break is always the profile id, so routing is
reproducible for identical inputs.

**Fallback**: governed, never a silent downgrade. A caller retries with
`excludeProfileIds` (never re-offers a candidate that already failed) and
`fallbackOf` (the new decision records which earlier one it replaces); the
SAME full pipeline runs again — a fallback candidate must pass capability,
availability and policy exactly like a primary one.

**No valid model**: a decision with no candidates at all, or all rejected,
selects nothing and records why (`reasonCodes`) — never a fake model, never
an arbitrary execution.

**IDOR**: `ModelRouter.get(projectId, id)` verifies the fetched decision's
own `projectId` matches — `DurableLedger.find` is keyed only by decision id,
so a caller possessing a real, valid id from another project must still
never see it. Checked at the router itself, not left to callers to
remember.

### Closing the real gap

`api/production-control-plane.ts` now: registers `"openai"` into
`ModelProviderRegistry`; declares one honest capability profile
(`reasoning`, `structured_output` — only what this agent actually
exercises, no fabricated vision/coding/large-context); constructs the
`ModelRouter`; and — via a new `RoutingAgentExecutor.replace` (upgrading a
bootstrap-time registration once the rest of the runtime exists, never a
general-purpose runtime swap) — rebinds `CONTROL_PLANE_ANALYSIS_AGENT_ID` to
an executor that routes and records usage.

`OpenAIAgentExecutor` gained optional `router`/`usageLedger` (both additive;
omitting either preserves the exact prior, unrouted behavior — verified by
the pre-existing test suite passing unchanged). With them: a call is routed
BEFORE the provider is ever invoked (SELECTED != EXECUTED is enforced, not
just claimed); a real response's usage is recorded, keyed by `task.id`
(idempotent — a retried task never double-charges); REQUESTED MODEL != ACTUAL
MODEL is tracked (the router's `selectedModel` vs the provider's own
`response.model`) and a mismatch is audited, never silently absorbed.

**Money-mind's budget gate has no pre-call cost estimator yet.** Forcing
EO-6.3's reviewed default (`allowUnknownCost: false`) here would have made
this agent's only real caller permanently unable to run — a worse outcome
than governing it. `GovernancePolicyStore.setTrusted` (new, mirrors
`SourceControlOrchestrator.setRepositoryPolicy`'s trusted-static-config
precedent, never a bypass of the admin-gated `set`) seeds `money-mind` with
`allowUnknownCost: true`. The REAL budget hard-stop still applies
unconditionally; only the "must have a known estimate" gate is relaxed, and
only for this one, already-scoped project.

### API surface

`GET /api/projects/:id/routing-decisions` (history) and
`/routing-decisions/:decisionId` (one, reconstructable — who requested it,
every rejected candidate and why, what was selected, whether it was a
fallback). Read-only; project-isolated (tested at both the router and HTTP
layers, including a real, valid decision id under the wrong project).

### Self-caught before review

While reviewing this file's own `providerRestrictions`/`modelRestrictions`
filter and `cost_efficient` ranking, the same bug class the EO-6.3 review
found in `GovernancePolicyEngine`'s model allow-list resurfaced here:
`providerRestrictions` was matched case-insensitively but `modelRestrictions`
and the `MODEL_PRICES` lookup were not, so a differently-cased but identical
model id would be wrongly excluded, or wrongly priced as "unknown". Fixed
(both sides lowercased consistently) and mutation-tested before the
independent review ran, not found by it.

### What was explicitly NOT done, and why

- **Manual model override** (`ManualModelOverrideRequest`,
  `validateManualModelOverride`, `providerRestrictions`/`modelRestrictions`
  on `ModelRequirementProfile`) is implemented and tested at the Router
  level, but has no HTTP command — there is no real caller today (the one
  production agent doesn't expose model choice to an operator). Building a
  command with nothing to call it would be decorative infrastructure, the
  same discipline this project has applied at every prior layer.
- **A second real provider** does not exist and was not invented. Section 9
  of the brief explicitly permits this: "current production may initially
  contain only OpenAI... do not invent fake Anthropic/Google/local
  integrations." The Router's ranking/fallback logic is real and tested
  with multiple FAKE candidates in `tests/model-router.test.ts` — it works
  the moment a second real provider is registered, without any router
  change.
- **Model health** is `available`/`unavailable` derived from registry
  presence — a fact genuinely known. No live health probe exists, so
  `degraded`/`disabled` are declared in the enum but nothing sets them; no
  fabricated live percentage anywhere.
- **Spatial Graph integration** (`MODEL`/`PROVIDER`/`ROUTING_DECISION`
  nodes) is deferred again, for the same reason ADR-0028 gave: it is a
  large, separate change to an already-reviewed subsystem
  (`contracts/graph.ts`, the fragment builder, revision hashing, the UI
  graph/inspector), and attempting it under this layer's time budget risked
  either a decorative integration (explicitly warned against) or an
  under-tested one.
- **The UI is read-only** (routing history / decision inspector); no write
  form, matching the Cost Center UI's own precedent.

### Two deliberate trade-offs, documented rather than hidden

- **A usage-recording failure fails the whole task.** `UsageLedger.record`
  runs inside the same `try` as the provider call in
  `OpenAIAgentExecutor.run`; if it throws (e.g. a transient Firestore
  error), the otherwise-successful analysis result is discarded and the
  task reports `model_failure`. The alternative — swallowing a recording
  failure — would create the opposite, worse gap this whole layer exists to
  close: real spend that is never recorded, permanently. Fail-closed here
  is the deliberate choice, consistent with the rest of this codebase.
- **Per-task idempotency can under-record on a retried task.** The
  idempotency key is `task.id`, so a genuine retry of the SAME task never
  double-charges it — but if a FIRST provider call succeeds (usage
  recorded) and a LATER step fails (e.g. `invalid_result`) causing a retry,
  the retry's real second provider call is billed by OpenAI but its usage
  is not separately recorded (the idempotent `record()` returns the first
  attempt's already-saved entry). Bounded and minor — retries are rare for
  a validation failure, and per-attempt keys would break the double-charge
  protection this ADR's tests specifically verify — but real, and disclosed
  here rather than left implicit.

### Fixed from independent security review

The exact bug class this ADR's own "self-caught" section already fixed
inside `model-router.ts` was found ONE MORE TIME, on a path this layer's
new integration newly exercises but did not itself touch:
`estimateCost` (`contracts/cost-center.ts`) looked up `MODEL_PRICES` without
lowercasing the model id, and `OpenAIAgentExecutor` now calls it with
`response.model` — a provider-reported, effectively untrusted string. Not
exploitable today (`MODEL_PRICES` has no OpenAI entries at all, so this
path is always "unpriced" regardless), but it would silently mis-price the
moment an OpenAI model is added to the table with different casing than
the provider reports. Fixed and mutation-tested. A separate, pre-existing
one-sided-lowercase read in `core/planning/model-capability-registry.ts`
the same review flagged was checked and found to be ALREADY safe —
`ModelCapabilityRegistry.register` normalizes `providerId` to lowercase at
registration time, so both sides of that comparison are already
lowercase; no change was needed there.

### Fixed from independent correctness review

**CRITICAL — a hard-stop budget could never actually stop real, unpriced
spend.** `evaluateBudget` (`contracts/cost-center.ts`) only ever summed
*priced* usage into the dollar totals it compared against a project's
configured limits; unpriced usage (every real OpenAI call today, since
`MODEL_PRICES` has no OpenAI entries) was reported only as an advisory
`"unpriced"` note alongside whatever the priced total happened to be — so a
hard-stopped, dollar-limited project could accumulate unlimited real,
unpriced spend and never once see `"blocked"`, because the priced total
(zero, or near it) never reached the limit no matter how much unpriced spend
piled up alongside it. Both governance paths (`GovernancePolicyEngine.decide`
and `ModelRouter.routeInternal`) only ever deny on `status === "blocked"`, so
this silently defeated the one enforcement mechanism (`hardStop`) whose
entire purpose is to guarantee a limit is never exceeded. Fixed: whenever
`policy.hardStop` is `true` AND at least one dollar limit is actually
configured (`taskLimitUsd`/`dailyLimitUsd`/`monthlyLimitUsd`), unpriced usage
now escalates the result to `"blocked"` — the priced total looking fine
proves nothing about the unpriced portion, so it is treated as unverifiable
spend under an active hard-stop, never assumed safe. When there is no
hard-stop, or no limit configured at all, unpriced usage remains the
existing advisory `"unpriced"` — there is nothing configured to enforce.
Proven at the real integration point with a `tests/model-router.test.ts`
repro matching the reviewer's exact scenario (50 real 2M-token `gpt-4o` usage
records, all unpriced, against a `$0.01/day` hard-stop) asserting
`routeInternal` now correctly reports `BUDGET_EXCEEDED` and selects nothing.
Mutation-tested (the escalation reverted, both this test and the rewritten
`tests/cost-center.test.ts` test failed exactly as expected, restored
byte-identical, both pass again); full regression re-run clean.

**MAJOR — `route()` and `routeInternal()` could report different
`reasonCode`s for the identical simultaneous-violation state.**
`GovernancePolicyEngine.decide` checks budget before the provider/model
allow-list; `ModelRouter.routeInternal`'s hand-duplicated governance logic
checked the allow-list before budget. For a project simultaneously
hard-stopped/exhausted AND missing the candidate's provider from its
allow-list, `route()` reported `BUDGET_EXCEEDED` while `routeInternal()`
reported `PROJECT_POLICY_DENIED` — the SAME real state, a different
reported reason purely as an artifact of which entry point happened to
evaluate it. This never enabled a bypass (both entry points correctly deny
either way), but it violates this ADR's own "SAME logic" claim and could
mislead debugging or auditing that branches on `reasonCode`. Fixed by
reordering `routeInternal`'s checks to budget-then-allow-list, matching
`decide` exactly. Added
`tests/model-router.test.ts`'s "MAJOR FIX" parity test (the same
simultaneous-violation state routed through both `route()` and
`routeInternal()`, asserting identical `reasonCode`s); mutation-tested (the
order reverted, the new parity test failed with `PROJECT_POLICY_DENIED` vs
the expected `BUDGET_EXCEEDED`, restored byte-identical, re-confirmed
passing); full regression re-run clean.

## Consequences

- The one real model-call path in this deployment is now governed and
  audited — whether or not a real API key is ever configured. Real USD
  cost tracking for it is honest but currently INERT for the same reason
  enforcement is inert elsewhere: `MODEL_PRICES` has no OpenAI entry, so
  every call's usage is recorded with real token counts but an honestly
  `{priced: false}` cost, surfaced as "cost unknown" in the UI — never a
  fabricated dollar figure. Token-count tracking, not dollar-cost tracking,
  is what actually happens today.
- `costCenterCapabilities.enforcement` and `providerIds` change meaning
  from prior layers' reports: they now correctly reflect a real, registered
  provider, not an empty registry. This is a correction toward honesty, not
  a new capability being claimed.
- `money-mind`'s governance policy has a real, documented default
  (`allowUnknownCost: true`) that did not exist before this layer; every
  other project remains fail-closed by EO-6.3's unchanged default.
- Adding a second real provider later requires only a `ModelCapabilityProfile`
  and a `ModelProviderRegistry.register` call — the Router, ranking and
  fallback logic need no change.
