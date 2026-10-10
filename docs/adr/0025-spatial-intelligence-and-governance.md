# ADR-0025: Spatial intelligence and the autonomy boundary (EO-5.8)

- Status: Accepted
- Date: 2026-09-26

## Context

EO-5.8 closes EO-5. Its purpose is to show that the Spatial Workforce can
_observe, reason over and help govern_ real workforce operations — not to grant
autonomy. This ADR records what was built, the evidence for the governance
claims, and — equally — what does **not** exist.

## Decision

### Spatial intelligence (read-only, grounded)

`core/orchestrator/graph-insights.ts` derives findings from the **authorised
graph only** (`GET /api/projects/:id/insights`, authorised exactly like the
graph). It is a pure function of `nodes` + `edges`: it imports only the graph
contract and a string helper — no store, service, command, execution, release,
network or filesystem code (asserted by a structural test).

Findings: blocked task (with the real blocking dependency and its status),
waiting-on-dependency, dependency bottleneck, failed execution, approval waiting
(naming the real subject through the real edge), environment that cannot place the
tasks that need it (its state is the best route status, so `blocked`/`offline`
means none could be placed; the counts say how many needed it) or that a session
is running on while down, ChangeSet waiting for review (plus a count when
several wait), deployment failed / degraded / rolled back / **accepted but not
yet verified** (DEPLOYED != VERIFIED).

Properties (each tested):

- **Grounded:** every finding carries evidence — real nodes with their state and
  status; a finding without evidence cannot exist, and the UI drops one.
- **No invention:** a healthy graph yields no findings; there are no
  probabilities, scores, ETAs or causes. Where the graph records _that_ something
  failed but not _why_, the finding carries the `cause_not_recorded` limitation
  and says so; every finding is `as_of_revision`.
- **UNKNOWN != ABSENT:** an unreadable execution source is reported
  (`unavailableSources`) and folded into the revision; an empty result with an
  unreadable source reads "the picture is incomplete", never "all clear".
- **SUGGESTION != COMMAND:** a recommendation is `{kind, targetNodeId,
relatedCommand?}` — a label and a target, no payload. `relatedCommand` names an
  existing command purely as text ("if you decide to act, the related action is
  ‘Retry task…’ in the inspector"). A retry is only mentioned when the linked
  task is itself recorded as failed. Acting on anything is the separate,
  confirmed, server-authorised inspector action of ADR-0024. The panel contains no
  command control.
- **Bounded and deterministic:** ≤100 findings (`truncated` says so), ordered by
  severity then kind then id, independent of input order.
- Insights follow the graph's revision (one refresh, no second polling loop).

### Autonomy boundary

Nothing in EO-5 adds autonomy. There is no new automation, no shell, Git or
deployment action available to the graph or to the intelligence layer, and no
change to permissions or secrets access. High-risk actions keep the existing
approval semantics; the only state changes reachable from the graph are the five
confirmed commands of ADR-0024.

## Governance evidence (what was verified, and where)

| Spec item                                                    | Evidence                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Detection, explanations, recommendations, evidence (82–85)   | `tests/spatial-intelligence.test.ts` (unit, grounding property, mutation-checked), UI `insights.test.tsx`                                                                                                                                                                                                                                              |
| Autonomy boundary, no unrestricted shell/Git/deploy (86, 93) | structural import test; `spatial-command-security`; `restricted-command-probe`; `eo48-security-gate` (injection, env, paths, SSRF, approval replay, artifact tamper)                                                                                                                                                                                   |
| Policy-bounded automation, deny by default (87)              | `execution-security` (policy deny by default; capabilities never imply each other)                                                                                                                                                                                                                                                                     |
| AVAILABLE != QUALIFIED (88)                                  | `tests/eo58-governance.test.ts`; `execution-security` preflight `AGENT_NOT_QUALIFIED`; `execution-planning` "no qualified agent → BLOCKED"                                                                                                                                                                                                             |
| Environment qualification (89)                               | `eo58-governance` (qualification before placement; no fabricated success); `software-factory-environment` (ROUTED / REQUIRES_PROVISIONING / NO_AVAILABLE / UNSUPPORTED); preflight `ENVIRONMENT_UNAVAILABLE`                                                                                                                                           |
| Agent != Model != Environment; OpenAI primary (90)           | `eo58-governance`: an agent's identity and its qualification do not depend on its model policy; graph node ids do not change with the model; the production configuration names `openai`. (Planning does use `modelPolicy` to judge _model eligibility_ — that is a separate decision from qualification, and is not claimed to be independent of it.) |
| Failure containment (94)                                     | `eo48` PARTIAL DEPLOYMENT, ROLLBACK FAILURE, PERSISTENCE FAILURE, ORPHANED SESSION; `release` DEPLOY/HEALTH FAILURE, REMOTE CHANGED, UNVERIFIED/UNREVIEWED, SELF REVIEW; E2E failing deployment; UI `liveGraph` (event-channel loss → reconnecting/degraded, last-known state kept)                                                                    |
| Recovery, no duplicated side effects (95)                    | `eo48` orphan reconcile + release restart; `release` rollback, commit idempotency; command state-machine tests (ADR-0024)                                                                                                                                                                                                                              |
| Cancel path (96)                                             | E2E (viewer denied, operator cancels through the command service, graph shows `cancelled`); `execution-security` cancellation                                                                                                                                                                                                                          |
| Audit reconstruction (97)                                    | E2E: plan → assigned agent → environment → session → ChangeSet → verification → review → approval → commit → release → result, all linked by recorded identifiers, plus the audited actions                                                                                                                                                            |
| End-to-end scenario, non-destructive (98)                    | `release.test.ts` "EO-5.8 E2E": real local Git + bare remote in a temp dir, real orchestrators, **test** deploy adapter (labelled simulated), through the graph and insights. Nothing touches production or a real remote.                                                                                                                             |

### Found by the scenario, and fixed

**Audit facts could be overwritten by command payload data.** `audited()` spread a
command's `details` _after_ the audit fields, so a details key with the same name
replaced them — cancelling an execution audited `outcome: "cancelled"` instead of
`executed`, and a caller-supplied `reason` replaced the audit reason. Payload data
is now written first and audit facts last; a colliding key survives under a
`detail…` name (e.g. `detailOutcome`). Reproduced by a failing test first.

## The release pipeline is NOT wired in production (verified) — superseded by ADR-0026

> Update (EO-6.1): the services are now composed in production, but as an INERT
> pipeline (no sandbox, Git or deployment adapter). See ADR-0026; the text below
> describes the state at the time of EO-5.

`api/production-control-plane.ts` builds the Control Plane context with
`execution` (sessions, ChangeSets) but **not** `verification`, `sourceControl` or
`deployments`, and nothing outside the tests constructs `VerificationService`,
`SourceControlOrchestrator` or `DeploymentOrchestrator`. Consequences in
production today:

- The graph cannot contain VERIFICATION, REVIEW, COMMIT or DEPLOYMENT nodes, and
  insights cannot report deployment problems (including DEPLOYED != VERIFIED).
  `REVIEW_WAITING` can only fire for ChangeSets that sessions produced.
- This is **reported, not hidden**: a source the deployment does not have is
  returned as `notConfiguredSources` (graph `metadata.notConfiguredSources`,
  insights `notConfiguredSources`), folded into the revision, and shown as "Not
  connected in this deployment: …". It is deliberately distinct from
  `unavailableSources` (a read that failed) and from an empty read. An empty insights
  list with a not-connected source reads "the picture is incomplete", never "all
  clear". (An earlier version treated an unwired source as "nothing happened"; an
  independent review caught it.)
- The end-to-end scenario passes because its test harness wires those services.
  It proves the projection and intelligence over the real orchestrators; it does
  **not** prove that production has them. The release-side intelligence becomes
  live only when those services are wired into the production context.

## What does NOT exist (reported, not invented)

- **No Model Router.** There is a provider-neutral `ModelProviderRegistry` and a
  per-agent `modelPolicy`, but no routing layer to verify. Agent/model separation
  is verified; routing is not.
- **No AI Cost Center.** There is no budget, token accounting or cost governance
  to integrate with. What exists is per-session **resource limits** (timeouts,
  output/artifact bytes, tool-call caps) enforced by policy, and session budgets
  (tests above). No cost value is shown anywhere.
- **No AI Auditor.** There is the general `AuditLog` (and the command audit above).
  (`contracts/onboarding.ts`, from a separate in-progress workstream, declares an
  `AuditBaseline` type described as an "AI Auditor baseline"; it has no
  implementation and is not part of this change.)
  Insights are read-only and deterministic: any finding can be reproduced from the
  state at its `graphRevision`. They are not individually audited, because they
  change nothing; every state-changing action a suggestion could lead to is
  audited as a command.

## Performance (measured, not tuned)

Median of 5 runs on the development machine: `deriveInsights` 4.6 ms (500 nodes),
15 ms (2,000), 132 ms (10,000); a full projection of 2,000 tasks ≈ 139 ms (bounded
to 500 nodes on output); the insight graph ≈ 55 ms. Records are shared per
project for 3 s (ADR-0023), so lifecycle **reads** are not repeated per tab, but
each poll still re-projects. Memory is bounded (event/transition history 100,
findings 100, cache 64 projects). No optimisation was made: nothing measured is a
material problem at realistic project sizes.

## Consequences / known limits

- **The environment rule was rewritten** after review: an `EXECUTES_IN` edge only
  exists for tasks that _were_ placed, so a rule keyed on it could never fire. It
  now uses the environment node's own counts and `RUNS_ON`, and is tested with the
  real fragment builder rather than a hand-drawn graph.
- An approval's node label carries its action ("Approval: commit") and the
  confirmation names what it gates ("Approval: commit → Commit abcdef1"), so a
  commit, a push and a deployment approval are distinguishable where the decision
  is made.

- Observations lag the recorded state by up to the polling interval plus the 3 s
  record-sharing window.
- Findings are only as good as what the graph records; the deliberate
  `cause_not_recorded` limitation is the price of never guessing a cause.
- The dependency-bottleneck and review-queue findings group by count (≥2); the
  number is a grouping, not a risk threshold.
- Authenticated production acceptance (real sessions, real projects, real
  isolation between AI Workforce and Money Mind) cannot be performed without a
  legitimate signed-in session and is reported separately.
