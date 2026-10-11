# ADR-0041: Extension Platform, Business Layer, Portfolio Intelligence, Autonomous Operations, Analytics (Layers 9–13)

## Status

Accepted

## Context

Layers 1–8 give the platform a governed core (prompt intelligence, orchestration, runtime, knowledge,
governance, integration hub). Layers 9–13 add extensibility, an organisational model, multi-project
awareness, controlled autonomy and analytics. The system stays a private single-user platform: no
tenants, customers, billing or enterprise RBAC. Nothing here duplicates the Control Plane, Agent Router,
Prompt Intelligence, Integration Hub or Knowledge layer; each new layer reads them through narrow ports.

The repository already contained thin enterprise stubs (`core/extension*`, `contracts/extension*.ts`,
`contracts/portfolio.ts`, `control/services/portfolio-service.ts`, `contracts/predictive.ts`). They carry
`organizationId`, return hard-coded values and are unused by the runtime, so they were **not** extended;
the new layers live in their own modules and the stubs are left untouched.

## Decisions

| Layer | Module | Core idea |
| --- | --- | --- |
| 9 Extension Platform | `core/extension-platform` | Extensions are **declarative manifests**. No code is executed, so the "sandbox" is validation: no executable keys, no secrets, bounded size, known permission scopes only. Permissions are requested in the manifest and **granted one by one by the owner**; `authorize()` denies by default. Versions are kept; switching version checks breaking changes and the dependants' version ranges. Enabling requires a passed test and security review (high-risk requests need the owner's approval of the review). |
| 10 Business Operating Layer | `core/business` | Business → board → executive functions → departments → managers → workforce → objectives → initiatives. It **owns no tasks or workflows**: it produces execution *plan proposals* and hands the objective text to Prompt Intelligence. KPIs are either manual or **measured from real platform data** and report `NO_DATA` rather than 0. Departments are archived, decisions superseded; nothing is hard-deleted. |
| 11 Portfolio Intelligence | `core/portfolio-intelligence` | Project health is a state plus the evidence behind it (runs, tasks, tests, deployments, alerts); no data means `UNKNOWN`. Dependencies (cycle-checked), declared and *observed* resource conflicts, a transparent priority score, and question answering over real data. Every read takes an `accessible(projectId)` filter; a relationship needs access to **both** projects. |
| 12 Autonomous Operations | `core/autonomy` | Levels 0–5 only change how much **LOW/MEDIUM** work runs without asking. HIGH, CRITICAL and restricted actions need the owner's approval at **every** level. Unknown actions are CRITICAL. A workflow runs TRIGGER → PLAN → RISK → APPROVAL POLICY → EXECUTION → OBSERVATION → VALIDATION → RECOVERY → REPORT through an injected executor; an action with no wired executor **blocks with a reason** instead of being simulated. Retries only for transient failures of idempotent actions with exponential back-off; everything else escalates. Rollback runs only where a reversal exists and is available, and reports the rest as not supported. Emergency stop and a global pause halt it. |
| 13 Analytics | `core/analytics-intelligence` | Analytics over runs, tasks, usage, alerts, approvals and tool activity. Predictions are **ranges with labels** (Wilson interval / linear trend) and say `LOW_CONFIDENCE` on small samples. Recommendations always carry a trade-off and need the owner's approval; "applied" is the owner's record, and the effect is **measured** against a baseline taken when it was applied. What-if is a read-only simulation. Lessons go to the Knowledge layer through its own write policy. |

Control and HTTP: `control/services/platform-layers-control.ts` (five thin services), capabilities
`manage_extensions|business|portfolio|autonomy|analytics`, routes `/extensions-platform`, `/business-layer`,
`/portfolio-intelligence`, `/operations-center`, `/analytics-intelligence`, commands prefixed
`extension_|business_|portfolio_|autonomy_|analytics_`. Consequential commands (enable, grant, approve plan,
set autonomy level, approve recommendation, …) are administrator-only on the server.

Wiring (`api/production-control-plane.ts`): durable collections are allocated before the single hydrate pass;
enabled skills are added to the Layer 3 context sources; Integration Hub events can create autonomous
workflows through trigger rules (never an execution by themselves); usage and onboarding records, which live
in async stores, are served from a 15-second snapshot.

## Consequences and honest limits

- **Autonomous executors are minimal.** In production only `inspect_logs`, `generate_report` and
  `read_repository` (through the Integration Hub) are wired. `run_tests`, `create_branch`,
  `prepare_pull_request`, `start_orchestrated_run`, commits, pushes and deployments have **no executor**, so
  workflows that need them block with that reason. The autonomous development loop and maintenance
  workflows therefore exist as governed definitions but cannot yet complete end to end in production.
- Extension types other than SKILL, AGENT, TOOL and WORKFLOW are registry-only. AGENT extensions are
  descriptors, not executable agents; a TOOL extension registers in the trust catalogue with no allowed agent.
- No timers: retries, schedule triggers and snapshot refreshes advance on request (`autonomy_tick`).
- Budget status is not fed into project health; business `AI_COST_USD` covers priced usage only.
- Predictions are statistical summaries of recorded history, not forecasts of certainty.
- Fixed in this change (Layer 8): the project registry stores `repository` as `{url, defaultBranch}`; the
  Integration Hub mapping sync expected a string and therefore created no GitHub mappings in production.
