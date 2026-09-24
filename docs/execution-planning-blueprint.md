# EO-3 — Execution Planning: read-only analysis & implementation blueprint

> Implemented in EO-3.1 — see [execution-planning.md](execution-planning.md).
> Deviations: the inputs fingerprint uses the core's `fnv1aHex` (the core stays
> free of `node:` imports) instead of SHA-256; the assignment type is named
> `PlanAgentAssignment` (`AgentAssignment` already exists in workflow
> contracts); the UI route is `/projects/:projectId/execution-plan`.

Analysed: local `main` @ 9f3ed38 + `origin/main` @ 90ca79f (4 commits ahead; PWA + functions packaging;
only backend file touched is `api/firebase-repositories.ts` hydration error handling — no conflict with planning).
Date: 2026-09-23. No files in the repository were modified during this analysis.

## 1. Verified repository findings (authoritative)

| Building block             | Exists?                 | Location                                                               | Finding                                                                                                                                                                                                        |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment Registry       | YES                     | core/environments/environment-registry.ts                              | Descriptors in-memory (code config); hosts + instances via sync `Repository<T>`. `usableInstances()` = instance+host available.                                                                                |
| Environment Router         | YES                     | core/environments/environment-router.ts                                | ROUTED / REQUIRES_PROVISIONING / NO_AVAILABLE_ENVIRONMENT. Returns only the first candidate (sorted by id). **No evidence, no rejected candidates, ignores trustLevel, no OS requirement.**                    |
| Toolchain matching         | YES (defect)            | core/environments/capability-mapping.ts                                | `satisfiesToolchainRequirements` checks `kind` only — **`ToolchainRequirement.minimum` is never enforced.**                                                                                                    |
| Technology Selector        | YES (EO-1)              | core/technology/technology-selector.ts                                 | Maps EnvironmentRequirement → descriptor (declared support). Does NOT map technologies (Swift, React…) to requirements.                                                                                        |
| Agent Qualification Router | YES                     | core/environments/agent-qualification-router.ts                        | String inclusion on `Agent.capabilities`; accepts `"*"`; conflates environmentType/descriptorId with agent capability; first-failure reason only.                                                              |
| Task Analyzer              | NO                      | —                                                                      | Must be created.                                                                                                                                                                                               |
| Project Architect          | NO                      | —                                                                      | Must be created.                                                                                                                                                                                               |
| Model Router               | NO                      | —                                                                      | Only `ModelProviderRegistry` (provider id → provider) and `Agent.modelPolicy {provider, model?}`. No model capability data anywhere.                                                                           |
| Approval infrastructure    | YES                     | core/approvals/approval-system.ts, contracts `Approval`                | Generic records (`action`, `decisionMetadata`); approve/reject via Control Plane commands. Name `ApprovalRequirement` is ALREADY TAKEN (task-level policy result).                                             |
| Audit                      | YES                     | core/audit/audit-log.ts, `AUDIT_EVENT_TYPES`                           | Convention: one type per domain (`workflow_event`, `project_adapter_event`) with `data.action`.                                                                                                                |
| Project Registry           | YES                     | core/registry/project-registry.ts                                      | Registrations of ProjectAdapters; `ProjectView` via query service.                                                                                                                                             |
| Persistence                | YES                     | contracts/persistence.ts, api/firebase-repositories.ts                 | Sync `Repository<T>`; Firestore via `FirestoreRepository` → `CachedRepository` (hydrate-once, write-through). Collections allocated in api/production-control-plane.ts. Firestore rules: deny-all for clients. |
| Control Plane              | YES                     | control/services/workforce-{query,command}-service.ts, api/http-api.ts | GET resource routes; `POST /api/commands/:name` via `COMMAND_METHODS`; every command → `ControlCommandResult` + `control_command` audit. Cross-project reads return `undefined` → 404 (existence hidden).      |
| AuthZ                      | YES (AUTHZ-1 not built) | contracts/control.ts                                                   | Custom claims `role` ∈ viewer/operator/admin + `allowedProjects`; deny-by-default `ROLE_CAPABILITIES`. AUTHZ-1 bootstrap/approval flow is NOT implemented — planning must use this existing model.             |
| Production data            | —                       | api/production-workforce-config.ts                                     | 5 descriptors, **0 hosts, 0 instances**, 1 agent (`control_plane_analysis`, `software_analysis`, OpenAI). → every real plan will honestly be BLOCKED today.                                                    |
| UI                         | partial                 | ui/src/pages                                                           | Projects = PlaceholderPage; no Project Detail. i18n (en/nl) + theme tokens exist.                                                                                                                              |
| Tests                      | —                       | tests/*.test.ts (node:test on dist), ui vitest                         | Backend: `npm run check` (typecheck, lint, format:check, test).                                                                                                                                                |

Naming collisions to avoid: `ApprovalRequirement` (exists), `Environment` (= deployment stage local/test/staging/production), `EnvironmentRequirement` (exists — REUSE, extend additively).

## 2. Architecture

```
ProjectRequest (structured, validated)
  → TaskAnalyzer           (deterministic; technology catalog lookup, no AI)
  → ProjectArchitect       (components: frontend/backend/mobile/desktop/game/…)
  → TechnologyRequirements (catalog profiles: toolchains, components, OS, capabilities)
  → EnvironmentRequirements (one per distinct component need → multi-env)
      → TechnologySelector (descriptor supported?)  → EnvironmentRouter.evaluate (instances, evidence)
  → AgentRequirements      → AgentQualificationRouter.evaluateCandidates (evidence)
  → ModelRequirements      → ModelCapabilityRegistry (declared profiles only)
  → DependencyGraph (DAG, cycle detection, deterministic topo order)
  → Build / Test / Security / Deployment stage planners (plans only)
  → PlanApprovalPlanner (policy table)
  → Blocker aggregation → status → ExecutionPlan
  → ExecutionPlanRepository (sync Repository<ExecutionPlan>) → Firestore `execution_plans`
Control Plane: query/command services → http-api.  UI: read-only view.
```

Invariants kept: AGENT ≠ MODEL ≠ ENVIRONMENT ≠ TOOL (separate requirement objects, separate resolvers);
Descriptor ≠ Instance (selection only from `usableInstances()`); Required (catalog) ≠ Available (registry);
Blocked ≠ Error (valid plan returned); Approval ≠ Execution (no execution code path at all).

## 3. File plan

New (backend):

- `contracts/planning.ts` — all planning types + validators; exported from `contracts/index.ts`.
- `core/planning/technology-catalog.ts` — declarative `TECHNOLOGY_PROFILES` (data table, no if/else chains).
- `core/planning/task-analyzer.ts`, `project-architect.ts`, `requirement-planner.ts`
- `core/planning/model-capability-registry.ts`
- `core/planning/dependency-graph.ts` (Kahn topo sort, tie-break by id, cycle → blocker)
- `core/planning/stage-planner.ts` (build/test/security/deployment)
- `core/planning/approval-planner.ts`
- `core/planning/plan-secret-guard.ts`
- `core/planning/plan-fingerprint.ts` (stable hash of inputs: request + registry snapshot + agents + policy)
- `core/planning/execution-plan-repository.ts` (wraps `Repository<ExecutionPlan>`; no Firestore import)
- `core/planning/execution-planning-service.ts`, `core/planning/index.ts`
- `docs/execution-planning.md`, `docs/adr/0012-execution-planning.md`
- `tests/execution-planning.test.ts`, `tests/execution-planning-control-plane.test.ts`, `tests/fixtures/planning/*.ts`

Modified (backend, additive):

- `contracts/environments.ts`: `ToolchainRequirement.components?: readonly {name: string; minimum?: VersionInfo}[]`
  (matched against `ToolchainDescriptor.componentVersions`; covers iOS SDK, Android build-tools, Unity modules,
  Unreal target platforms, npm/pnpm); `EnvironmentRequirement.os?: {os?: OsName; architecture?: Architecture}`;
  `EnvironmentRequirement.minimumTrust?: TrustLevel`; new `EnvironmentMatchEvidence` type.
- `core/environments/capability-mapping.ts`: enforce `minimum` via `versionAtLeast`; component matching. (Bug fix.)
- `core/environments/environment-router.ts`: new `evaluate(requirement)` → `{selected?, candidates[], rejected[{instanceId, reasonCodes}], outcome}`;
  `route()` delegates to it (same outcomes). Deterministic tie-break: trust (verified > detected > declared) →
  toolchain version (higher first) → instance id asc. No scoring.
- `core/environments/agent-qualification-router.ts`: new `evaluateCandidates(agents, agentRequirement, isEnabled)`
  → per-agent `{agentId, qualifies, matched[], missing[], reasonCodes}`; planning path uses NO `"*"` wildcard and
  never "closest agent". Existing `qualify/route` unchanged.
- `contracts/index.ts`: add `"execution_plan_event"` to `AUDIT_EVENT_TYPES`.
- `contracts/control.ts`: capabilities `create_execution_plan`, `replan_execution_plan`, `submit_execution_plan`
  (operator + admin; viewer = view only); `CONTROL_COMMANDS` + inputs; `ExecutionPlanView`, `ExecutionPlanSummaryView`.
- `control/context.ts`: optional `planning?: ExecutionPlanningService` (absent → empty results, like `environments`).
- `control/services/workforce-query-service.ts`: `getExecutionPlans(principal, projectId, query)` (PageResult),
  `getExecutionPlan(principal, projectId, planId, version?)`.
- `control/services/workforce-command-service.ts`: `createExecutionPlan`, `replanExecutionPlan`, `submitExecutionPlan`;
  `approve`/`reject` hook: approval with `decisionMetadata.executionPlanId` → plan APPROVED / BLOCKED(APPROVAL_REJECTED).
- `api/http-api.ts`: `GET /api/projects/:projectId/execution-plans[/:planId]` (nested, like `/agents`);
  commands `create-execution-plan`, `replan-execution-plan`, `submit-execution-plan`.
- `api/production-control-plane.ts`: allocate `execution_plans` collection before `hydrateAll()`; wire service.

New/modified (UI, minimal, read-only):

- `ui/src/features/executionPlans/` (types mirrored from contracts, API client, hooks via TanStack Query).
- `ui/src/pages/Projects/ProjectsPage.tsx` (list from existing `GET /api/projects`) and
  `ui/src/pages/Projects/ExecutionPlanPage.tsx` at `/projects/:projectId/execution-plan`.
- `ui/src/app/router.tsx`, `ui/src/i18n/locales/{en,nl}.ts`, tests. Tokens only; no execute/run/deploy control —
  a disabled "Execution — available in EO-4" note.

## 4. Domain contract (contracts/planning.ts)

```ts
type PlanStatus =
  | "draft"
  | "blocked"
  | "ready"
  | "awaiting_approval"
  | "approved"
  | "superseded";
type ComponentKind =
  | "web_frontend"
  | "backend_service"
  | "mobile_app"
  | "desktop_app"
  | "game"
  | "3d_application"
  | "library";
type TargetPlatform = "web" | "ios" | "android" | "windows" | "macos" | "linux";

interface ProjectRequest {
  projectId;
  title;
  summary;
  components: ProjectComponentRequest[];
  deployment?: DeploymentIntent[];
  constraints?: {
    dataSensitivity?: "public" | "internal" | "confidential";
    destructiveMigration?: boolean;
    privilegedInfrastructure?: boolean;
  };
}
interface ProjectComponentRequest {
  id;
  kind: ComponentKind;
  platforms: TargetPlatform[];
  technologies: TechnologyId[] /* catalog ids, e.g. "react_typescript", "swiftui", "dotnet_aspnet", "android_kotlin",
  "unity", "unreal", "node_backend", "dotnet_wpf" */;
  versions?: Record<string, string>;
}

interface TaskAnalysis {
  requestFingerprint;
  components: AnalysedComponent[];
  unknownTechnologies: string[];
}
interface ArchitectureRequirement {
  style: "single_platform" | "multi_platform";
  components: { componentId; kind; platforms }[];
}
interface TechnologyRequirement {
  componentId;
  technologyId;
  toolchains: ToolchainRequirement[];
  os?;
  capabilities: CapabilityId[];
}
interface PlannedEnvironmentRequirement {
  id;
  componentIds: string[];
  requirement: EnvironmentRequirement;
  descriptorSupport: "supported" | "unsupported";
  match: EnvironmentMatchEvidence;
}
interface AgentRequirement {
  id;
  stageIds: string[];
  requiredCapabilities: string[];
  taskType: string;
}
interface AgentAssignment {
  requirementId;
  agentId?: string;
  requiredCapabilities;
  matchedCapabilities;
  qualification: "qualified" | "none_qualified";
  candidates: AgentCandidateEvidence[];
}
interface ModelRequirement {
  id;
  agentRequirementId;
  capabilities: ModelCapability[] /* reasoning|coding|vision|structured_output|large_context */;
  eligibleProfiles: string[];
}
interface DependencyRequirement {
  id;
  kind: "toolchain" | "package_manager" | "sdk" | "engine_module" | "compiler";
  name;
  minimum?: VersionInfo;
  requiredBy: string[];
  dependsOn: string[];
}
interface BuildStage {
  id;
  componentId;
  inputs: string[];
  environmentRequirementId;
  requiredCapabilities;
  dependencyIds;
  expectedArtifact: { kind; name };
  validation: string[];
}
interface TestStage {
  id;
  componentId;
  type:
    | "unit"
    | "integration"
    | "ui"
    | "e2e"
    | "build_verification"
    | "security"
    | "platform_specific";
  environmentRequirementId;
  dependsOnStageIds;
}
interface SecurityStage {
  id;
  type:
    | "sast"
    | "dependency_scan"
    | "secret_scan"
    | "permission_review"
    | "security_agent_review";
  scope: string[];
  agentRequirementId?;
}
interface DeploymentRequirement {
  id;
  componentId;
  targetType:
    | "firebase_hosting"
    | "cloud_run"
    | "app_store"
    | "play_store"
    | "container_registry"
    | "desktop_installer"
    | "none";
  stage: Environment;
  requiredArtifact;
  environmentRequirementId?;
  credentialRef?: CredentialReference;
  preDeploymentGates: string[];
  rollbackRequired: boolean;
}
interface CredentialReference {
  kind: "secret_manager" | "credential_id" | "alias";
  ref: string;
} // never a value
interface PlanApprovalRequirement {
  id;
  reason:
    | "production_deployment"
    | "destructive_migration"
    | "privileged_infrastructure"
    | "high_cost";
  stageIds;
  approvalId?: string;
  state: "not_requested" | "requested" | "approved" | "rejected" | "expired";
}
interface ExecutionBlocker {
  code: BlockerCode;
  severity: "blocking";
  subjectType:
    | "environment"
    | "agent"
    | "model"
    | "dependency"
    | "approval"
    | "technology";
  subjectId;
  reasonCodes: string[];
  missing?: string[];
}
type BlockerCode =
  | "MISSING_ENVIRONMENT"
  | "MISSING_CAPABILITY"
  | "MISSING_TOOLCHAIN"
  | "UNSUPPORTED_TECHNOLOGY"
  | "NO_QUALIFIED_AGENT"
  | "DEPENDENCY_CONFLICT"
  | "MISSING_MODEL_CAPABILITY"
  | "APPROVAL_REJECTED";

interface ExecutionPlan {
  id /* `${planId}@v${version}` */;
  planId;
  version;
  projectId;
  status: PlanStatus;
  request;
  analysis;
  architecture;
  technologies;
  environments: PlannedEnvironmentRequirement[];
  agents: AgentAssignment[];
  models: ModelRequirement[];
  dependencies: { items; order: string[] };
  build;
  tests;
  security;
  deployment;
  approvals: PlanApprovalRequirement[];
  blockers: ExecutionBlocker[];
  inputsFingerprint;
  supersedes?: string;
  supersededBy?: string;
  createdBy;
  createdAt;
  updatedAt;
  cost: { status: "not_estimated" };
  schemaVersion: 1;
}
```

`APPROVAL_REQUIRED` is modelled as `PlanApprovalRequirement` (a governance gate), not as a hard blocker;
`BLOCKED` is reserved for conditions that make execution impossible. All ids stable; display names never used as identity.

## 5. Decisions

1. **Task analysis** is deterministic: only structured `ProjectRequest` + catalog lookup. Free text (`summary`) is
   never parsed. Unknown technology id → `UNSUPPORTED_TECHNOLOGY` blocker (not an exception). A later AI-assisted
   analyzer may only produce a `ProjectRequest` that passes the same validator. No model call in EO-3.1.
2. **Technology catalog** (data table): e.g. `swiftui` → toolchain `swift_xcode` + component `ios_sdk`, os macos,
   capability `mobile_build_capable`, agent capability `ios_development`, test types unit/ui/platform_specific,
   artifact `ipa`. `android_kotlin` → `jdk_gradle` + `android_sdk` (component `build_tools`), agent `android_development`.
   `dotnet_wpf` → `dotnet`, os windows. `unity` → toolchain `unity` (min version) + components `module:<target>`.
   `unreal` → `unreal` + `cpp_compiler` + components `platform:<target>`. `react_typescript` → `node` + component `npm`,
   capability `web_build_capable`. Extending = adding a row.
3. **Environment requirements**: one per component; identical requirements are merged (`componentIds[]`) →
   multi-environment plans are natural (React + .NET + Android = 3).
4. **Environment selection** only via `EnvironmentRouter.evaluate` over usable instances. Outcome mapping:
   ROUTED → satisfied; REQUIRES_PROVISIONING → `MISSING_ENVIRONMENT`; descriptor exists & instance lacks capability →
   `MISSING_CAPABILITY`; lacks toolchain/component/version → `MISSING_TOOLCHAIN`. Evidence stores selected,
   matched/missing capabilities, rejected candidates + reason codes. No prose.
5. **Agent qualification**: `Agent.capabilities` registered server-side in the AgentRegistry = the verified set
   (documented). Agent must be enabled (AgentOperationalStore), have the project in `allowedProjects`, and declare all
   required capabilities. No wildcard, no nearest match → `NO_QUALIFIED_AGENT`. Tie-break among qualified
   agents: agent id ascending only (no opaque scoring).
6. **Model requirements**: `ModelCapabilityRegistry` of declared profiles `{providerId, model?, capabilities[]}`.
   Agent's `modelPolicy` must resolve to a profile covering required capabilities, else `MISSING_MODEL_CAPABILITY`.
   Production registers no profile unless explicitly configured → honest blocker. No model is invoked.
7. **Dependencies**: DAG, max-minimum merge of duplicate requirements; cycles or incompatible pins →
   `DEPENDENCY_CONFLICT`; order = Kahn topo sort with id tie-break.
8. **Stages**: build/test/security/deployment are templates from catalog + request; stage status is never stored
   (no PASS/FAIL). Security baseline always: `secret_scan`, `dependency_scan`; `sast` where catalog marks language
   support; `permission_review` + `security_agent_review` (agent capability `security_review`) when any production
   deployment exists.
9. **Approvals** (policy table): production deployment, destructive migration, privileged infrastructure. High cost is
   `not_assessed` (no cost data). `submit-execution-plan` (only from `ready` with ≥1 approval requirement) creates an
   `Approval` (`action: "execution_plan.approve"`, `decisionMetadata: {executionPlanId, projectId, version}`) →
   `awaiting_approval`. Existing `approve` → `approved`; `reject` → `blocked` + `APPROVAL_REJECTED`.
   Approved changes governance state only.
10. **Lifecycle**: `draft` (in-service only) → `blocked` | `ready`; `ready` → `awaiting_approval` → `approved` |
    `blocked`; any non-superseded → `superseded` on replan. Invalid transitions → `StateTransitionError` (409).
11. **Versioning / replan**: plan documents are immutable except status/supersede fields. Replan re-runs the
    pipeline with the stored `request`; if `inputsFingerprint` is unchanged → returns existing version (`unchanged`,
    no new doc); otherwise creates `version+1`, marks previous `superseded` (`supersededBy`), expires its pending
    approval. V1 stays readable.
12. **Determinism**: service takes injected `clock` and `idFactory`; all collections sorted by id before output;
    fingerprint = SHA-256 of canonical JSON (node:crypto `createHash`, no child_process).
13. **Persistence**: Firestore collection `execution_plans` (doc id = plan `id`), through existing
    FirebaseRepositoryProvider/CachedRepository. Size bound: reject plans > 200 KB serialized. Known limitation
    (ADR-0011): hydrate-once cache per function instance.
14. **Project isolation**: every query/command requires `operatorCanAccessProject` AND a registered project
    (ProjectRegistry) — unknown or foreign project → `not_found` (404, existence hidden), same as existing project routes.
15. **Audit**: `execution_plan_event` with `data.action` ∈ `created | blocked | ready | replanned | superseded |
approval_required | approved | approval_rejected`, `projectId`, `planId`, `version`, `correlationId`; plus the
    standard `control_command` event.
16. **Secrets**: `CredentialReference` validated by pattern (`projects/<p>/secrets/<name>` or `^[a-z0-9_.-]{1,64}$`);
    `plan-secret-guard` scans the serialized plan for key/password/private-key/token patterns before every write →
    ValidationError.
17. **Security boundary**: `core/planning` must not import `child_process`, `adapters/execution`, or any probe; a test
    asserts this by scanning the source files.
18. **Cost**: `cost: {status: "not_estimated"}` only.

## 6. Test matrix (fixtures in tests/fixtures/planning, never in production config)

React web (ready path) · iOS ready (macOS host + xcode instance with swift_xcode + ios_sdk) · iOS blocked
(MISSING_ENVIRONMENT) · Android incomplete (android_studio instance without android_sdk → MISSING_TOOLCHAIN) ·
Windows .NET (linux host with dotnet rejected, windows host selected) · Docker (docker instance with
`container_runtime_available: false` → MISSING_CAPABILITY) · Unity (editor version + module component) · Unreal
(engine + cpp_compiler + platform component) · Multi-environment (React+.NET+Android → 3 env requirements) · No agent
(NO_QUALIFIED_AGENT) · Project isolation via HTTP API (404) + command denied (403 for viewer) · Determinism (N runs →
identical selections/fingerprint) · Replan V1 blocked → register instance → V2 ready, V1 superseded & intact ·
Secret safety (serialized plan free of secret patterns; secret-like credentialRef rejected) · Toolchain minimum
version now enforced (router regression test) · Security gate (no forbidden imports).
UI (vitest): renders required/available/selected/missing/blocked/ready distinctions, en+nl, light+dark, no execute control.

## 7. Implementation preconditions for EO-3.1

1. `git pull --ff-only origin main` first (local is 4 commits behind; upstream does not touch `ui/.env.example`,
   so the uncommitted local change survives). Never commit `ui/.env.example` or `.claude/`.
2. EO-3.1's own no-commit/no-push/no-deploy rule overrides the standing release rule for that prompt.
3. Backend changes will later need `firebase deploy --only functions` — only after explicit authorization.

## 8. Risks

- Production has no hosts/instances and one agent → all real plans BLOCKED (correct, but set expectations in UI).
- Approve/reject hook touches an existing command path → covered by existing approval tests + new ones.
- Router tie-break/version enforcement changes EO-2A behaviour slightly → run existing environment tests.
- Requiring registered projects means plans can only be made for projects in the ProjectRegistry.

EO-3 READ-ONLY ANALYSIS: COMPLETE
EO-3 IMPLEMENTATION BLUEPRINT: COMPLETE
WORKING TREE PROTECTION: PASS
IMPLEMENTATION READY: YES
