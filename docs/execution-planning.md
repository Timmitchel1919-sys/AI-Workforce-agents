# Execution Planning (EO-3.1)

> **EO-3.1 PLANS WORK. EO-3.1 DOES NOT EXECUTE WORK.**
>
> Nothing in the planning layer runs a command, a probe, a build, a model, a
> scan or a deployment. An `approved` plan only changes governance state;
> execution belongs to EO-4.

An `ExecutionPlan` is the authoritative description of _intended_ execution for
one project: what is built, which technologies, environments, agents and model
capabilities it requires, which registered environments and qualified agents
satisfy that, how it would be built, tested, secured and deployed, which
approvals it needs, and what currently blocks it.

## Architecture

```
ProjectRequest (structured, validated — normalizeProjectRequest)
  → TaskAnalyzer            deterministic catalog lookup, no AI, no free-text parsing
  → ProjectArchitect        architecture + one environment requirement per component/OS
  → TechnologySelector      is the environment TYPE supported? (descriptor)
  → EnvironmentRouter.evaluate   which REAL instance satisfies it? (evidence)
  → AgentQualificationRouter.evaluateCandidates   which agent is QUALIFIED?
  → ModelCapabilityRegistry model eligibility from DECLARED profiles
  → dependency DAG          topological order, cycle/unknown detection
  → stage planner           build / test / security / deployment / approvals
  → blockers → status → ExecutionPlan
  → ExecutionPlanRepository → Repository<ExecutionPlan> → Firestore `execution_plans`
Control Plane: WorkforceQueryService / WorkforceCommandService → /api
UI: Projects → Execution Plan (read-only)
```

| Code                                          | Role                                                        |
| --------------------------------------------- | ----------------------------------------------------------- |
| `contracts/planning.ts`                       | Plan contract, lifecycle, validators, request normalization |
| `core/planning/technology-catalog.ts`         | Declarative technology REQUIREMENT table                    |
| `core/planning/task-analyzer.ts`              | Request → technology requirements                           |
| `core/planning/project-architect.ts`          | Architecture + environment requirements                     |
| `core/planning/dependency-graph.ts`           | Dependency DAG                                              |
| `core/planning/stage-planner.ts`              | Build/test/security/deployment/approval plans               |
| `core/planning/model-capability-registry.ts`  | Declared model profiles                                     |
| `core/planning/execution-plan-repository.ts`  | Versioned persistence                                       |
| `core/planning/execution-planning-service.ts` | Orchestrates the above; lifecycle; audit                    |
| `control/plan-views.ts`                       | Safe API views                                              |

Separation is explicit: **AGENT ≠ MODEL ≠ ENVIRONMENT ≠ TOOL**. Each has its own
requirement type and resolver; none is collapsed into another.

## ExecutionPlan contract

Key fields (see `contracts/planning.ts`): `id` (`${planId}@v${version}`),
`planId` (series), `version`, `projectId`, `status`, `request`, `analysis`,
`architecture`, `environments[]`, `agentRequirements[]`, `agents[]`, `models[]`,
`dependencies`, `build[]`, `tests[]`, `security[]`, `deployment[]`,
`approvalRequirements[]`, `approval`, `blockers[]`, `inputsFingerprint`,
`supersedes`/`supersededBy`, `cost: { status: "not_estimated" }`.

Every stage carries the literal status `"planned"` — PASS/FAIL, coverage,
"scan passed" or "deployed" are not representable.

## Lifecycle

| From                      | To                                                      |
| ------------------------- | ------------------------------------------------------- |
| `draft` (in-service only) | `blocked`, `ready`                                      |
| `blocked`                 | `superseded`                                            |
| `ready`                   | `awaiting_approval`, `superseded`                       |
| `awaiting_approval`       | `approved`, `blocked` (approval rejected), `superseded` |
| `approved`                | `superseded`                                            |

Status is always derived server-side: blockers → `blocked`, otherwise `ready`.
A client-supplied status, agent, environment or approval is dropped.

## Blockers — BLOCKED ≠ ERROR

A project that needs an environment nobody registered is a valid plan with
`status: "blocked"`, not an exception. Blockers are structured objects:

| Code                       | When                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MISSING_ENVIRONMENT`      | no instance of a compatible type/OS is usable (none registered, host/instance unavailable, wrong OS/arch, trust too low)    |
| `MISSING_CAPABILITY`       | a compatible instance exists but a required capability is not available (e.g. Docker installed, runtime not usable)         |
| `MISSING_TOOLCHAIN`        | a compatible instance lacks a toolchain, minimum version or component (e.g. Android Studio without Android SDK build tools) |
| `UNSUPPORTED_TECHNOLOGY`   | unknown technology id, or incompatible component kind/platform                                                              |
| `NO_QUALIFIED_AGENT`       | no enabled agent, allowed on the project, declares every required capability                                                |
| `MISSING_MODEL_CAPABILITY` | the qualified agent's model policy has no declared profile covering the required capabilities                               |
| `DEPENDENCY_CONFLICT`      | dependency cycle or reference to an unknown dependency                                                                      |
| `APPROVAL_REJECTED`        | the plan's approval was rejected                                                                                            |

## Environment selection

Descriptor ≠ Instance: a registered descriptor only means the workforce can
_support_ a type. Selection uses only instances that are available on an
available host and satisfy the type/OS/architecture/trust, capability,
toolchain, minimum-version and component requirements. The router returns
evidence for every instance (eligible, reason codes, matched/missing
capabilities, missing toolchains).

Tie-break among eligible instances (deterministic, no scoring): trust level
(verified > detected > declared) → environment version (higher first) →
instance id (ascending).

Since EO-3.1 the router also enforces `ToolchainRequirement.minimum` and
`components` (EO-2A only compared the toolchain kind).

## Agent qualification

AVAILABLE AGENT ≠ QUALIFIED AGENT. An agent qualifies only when it is enabled
(`AgentOperationalStore`), may work on the project (`allowedProjects` empty =
project-neutral), and declares every required capability in the server-side
`AgentRegistry`. There is no wildcard and no nearest match. Among qualified
agents the lowest id wins. Assignments reference stable ids, never names.

## Dependency, build, test, security and deployment planning

- **Dependencies**: `toolchain:<kind>` and `toolchain:<kind>:<component>` nodes,
  plus catalog edges (e.g. `android_sdk → jdk_gradle`, `unreal → cpp_compiler`).
  Duplicates merge to the highest minimum version; order is a topological sort
  with id tie-break. Nothing is installed.
- **Build**: one stage per component — inputs, environment requirement,
  capabilities, dependencies, agent requirement, expected artifact, validation.
- **Tests**: planned test types from the catalog (`unit`, `integration`, `ui`,
  `e2e`, `build_verification`, `security`, `platform_specific`).
- **Security**: always `secret_scan` + `dependency_scan`; `sast` where the
  language supports it; production deployments add `permission_review` and a
  `security_agent_review` (requires an agent with `security_review`).
- **Deployment**: target type, stage, required artifact, environment,
  credential _reference_, pre-deployment gates, rollback requirement.

## Approval integration

Policy table: production deployment, destructive migration and privileged
infrastructure require approval (high cost is not assessed — there is no cost
data). `submit-execution-plan` (only from `ready`) creates a normal `Approval`
(`action: "execution_plan.approve"`, `decisionMetadata.executionPlanId`) and
moves the plan to `awaiting_approval`. The existing `approve` / `reject`
commands decide it; the plan mirrors the decision (`approved` /
`blocked` + `APPROVAL_REJECTED`). The frontend can never set approval state.

## Versioning and replanning

Versions are separate documents and are never rewritten: after creation only
lifecycle fields (`status`, `approval`, `blockers` on rejection,
`supersededBy`, `updatedAt`) may change, and only along an allowed transition.
The current revision is the highest version number.

`replan-execution-plan` re-evaluates the current revision against today's
registry, agents and policy. If the `inputsFingerprint` is unchanged the
current revision is kept (`unchanged`); otherwise version _n+1_ is created and
version _n_ becomes `superseded` (a pending approval on it is expired).

## Control Plane API

| Route                                                                | Capability              |
| -------------------------------------------------------------------- | ----------------------- |
| `GET /api/projects/:projectId/execution-plans?limit&cursor`          | `view`                  |
| `GET /api/projects/:projectId/execution-plans/:planId[?version=N]`   | `view`                  |
| `POST /api/commands/create-execution-plan` (body = planning request) | `create_execution_plan` |
| `POST /api/commands/replan-execution-plan` `{ planId }`              | `replan_execution_plan` |
| `POST /api/commands/submit-execution-plan` `{ planId }`              | `submit_execution_plan` |

Operators and admins hold the planning capabilities; viewers can only read.
Reads of unknown or foreign projects/plans return **404** (no existence leak);
commands on foreign projects return **403**; an authenticated user without an
AI Workforce role (awaiting access) gets **401**. There is **no execution
route**.

## Security boundary

- Firebase Auth → ID token → Control Plane → service → repository → Firestore.
  Firestore rules stay deny-all for clients; the UI never reads plans directly.
- Plans hold credential **references** only (`secret_manager`, `credential_id`,
  `alias`). A secret-looking value anywhere in a plan is refused before write;
  API views reduce references to their kind.
- `core/planning` has no process-execution surface (enforced by a test that
  scans the sources for `child_process`, `spawn`, `shell: true`, … and `node:`).
- Production seeds nothing: no plans, hosts, instances or model profiles. With
  today's production registry every real plan is honestly `blocked`.

## EO-3.2 — Integration, persistence and concurrency

```
Project (ProjectRegistry, stable projectId)
  ↓  POST /api/commands/create-execution-plan        (Firebase ID token → operator claims)
Control Plane — WorkforceCommandService / WorkforceQueryService
  ↓
ExecutionPlanningService
  ↓  EnvironmentRegistry (real instances) · AgentQualificationRouter · ModelCapabilityRegistry
ExecutionPlan  (validated, canonical, secret-free)
  ↓  serializeExecutionPlan
ExecutionPlanStore.commit(change)   ← atomic, optimistic precondition
  ↓
Firestore  execution_plans/{planId@vN} + execution_plan_heads/{planId}
```

### Persistence and serialization

- `serializeExecutionPlan` validates the full contract and referential
  integrity (unique ids, stage → environment/agent references, dependency
  graph edges and order), refuses secrets and documents over 200 KB, drops
  `undefined` and sorts keys — the same plan always yields the same record.
- `deserializeExecutionPlan` is **fail-closed**: a stored record that does not
  satisfy the contract raises `CorruptPlanRecordError`. Nothing is invented,
  nothing partially valid is returned; the API answers a generic HTTP 500
  (`stored execution plan record failed validation`) without echoing content.
- The service always hands out the canonical round-tripped plan, so memory and
  storage are identical.
- Plans store environment-selection evidence (selected instance, candidates,
  reason codes) and qualification evidence (required/matched capabilities,
  selected agent id) — never host credentials, never a second agent list.

### Versioning and the current revision

- One document per version; content is immutable after creation. Only
  `status`, `approval`, `blockers` (on rejection), `supersededBy` and
  `updatedAt` change, along the lifecycle.
- The **current** revision is the highest version number, mirrored in the
  series head (`execution_plan_heads/{planId}.currentVersion`). Client
  timestamps are never used.
- `GET /api/projects/:projectId/execution-plans/current` returns the current
  revision of the project's newest plan series (`{ plan: null }` when none).

### Concurrency

Every mutation is one `ExecutionPlanStore.commit` with a precondition checked
inside a Firestore transaction:

| Change                           | Precondition                                                              | Writes                                     |
| -------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| `create_series`                  | head does not exist                                                       | `create` v1, `create` head                 |
| `new_revision` (replan)          | head = expected version, previous revision unchanged (status + updatedAt) | `create` vN+1, set vN superseded, set head |
| `transition` (submit / approval) | version is current and unchanged                                          | set version                                |

The loser of a race gets `PlanRevisionConflictError` (HTTP 409 `invalid_state`),
nothing is written, and its instance reloads the series. A version document is
created with `create`, which fails if it exists — history can never be
overwritten. A losing approval submission expires the approval it requested,
so no orphan approval remains.

Reads go to the authoritative store on every request (project- or
series-scoped equality queries), so all Cloud Functions instances see the same
plans. The plan collection is **not** behind the hydrate-once write-through
cache (ADR-0011) — that cache is single-writer.

### Indexes

Only single-field equality queries are used (`projectId ==`, `planId ==`),
served by Firestore's automatic single-field indexes. Sorting and cursor
pagination (`DEFAULT_PAGE_SIZE` 25, `MAX_PAGE_SIZE` 200, malformed cursor →
first page) happen server-side on the project-scoped result. No composite
index is required; none was added.

### Operations

| Operation    | Route                                                              | Authorization                                                      |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| CREATE       | `POST /api/commands/create-execution-plan`                         | `create_execution_plan` + project access; project must exist (404) |
| READ         | `GET /api/projects/:projectId/execution-plans/:planId[?version=N]` | `view` + project access (404 otherwise)                            |
| READ current | `GET /api/projects/:projectId/execution-plans/current`             | `view` + project access                                            |
| LIST         | `GET /api/projects/:projectId/execution-plans?limit&cursor`        | `view` + project access                                            |
| REPLAN       | `POST /api/commands/replan-execution-plan` `{ planId }`            | `replan_execution_plan` + project access                           |
| SUBMIT       | `POST /api/commands/submit-execution-plan` `{ planId }`            | `submit_execution_plan` + project access                           |

Authentication is the existing Firebase ID token → `FirebaseOperatorDirectory`
(custom claims `role` + `allowedProjects`). A signed-in user without an AI
Workforce role (awaiting access) is 401 on every route. Server-side planning is
authoritative: status, agents, environments, approvals sent by a client are
ignored.

### Audit

`execution_plan_event` with `data.action` ∈ `created`, `blocked`, `ready`,
`replanned`, `superseded`, `replan_unchanged`, `approval_required`,
`approved`, `approval_rejected`; plus the standard `control_command` event for
every command (including denied ones). Audit events are append-only; replanning
never removes history.

### Project removal

The `ProjectRegistry` has no delete or archive operation today. Plans are never
cascade-deleted: if a project is ever unregistered, its plans and audit
history remain in storage but become unreachable through the API (404), until
an explicit archive policy is designed.
