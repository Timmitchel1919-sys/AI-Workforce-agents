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
