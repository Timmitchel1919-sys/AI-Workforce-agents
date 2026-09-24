/**
 * Execution Planning contracts — EO-3.1.
 *
 * An `ExecutionPlan` is the authoritative description of INTENDED execution:
 * what is built, which technologies/environments/agents/models it requires,
 * which registered environments and qualified agents satisfy that, how it would
 * be built, tested, secured and deployed, which approvals it needs, and what
 * currently blocks it.
 *
 * EO-3.1 PLANS WORK. IT DOES NOT EXECUTE WORK. Nothing in this file describes a
 * command, a shell, a credential value or an execution result. Every stage
 * carries the literal status `"planned"`; pass/fail results are not
 * representable here.
 *
 * Separation kept explicit: AGENT (responsible worker) ≠ MODEL (intelligence
 * the agent uses) ≠ ENVIRONMENT (execution location/toolchain) ≠ TOOL (bounded
 * capability). Each has its own requirement type and resolver.
 */
import {
  ENVIRONMENTS,
  requireArray,
  requireText,
  ValidationError,
  type Environment,
} from "./index.js";
import {
  type Architecture,
  type CapabilityId,
  type EnvironmentMatchEvidence,
  type EnvironmentRequirement,
  type OsName,
  type ToolchainKind,
  type ToolchainRequirement,
  type VersionInfo,
} from "./environments.js";

/* ------------------------------------------------------------------ */
/* Project request                                                    */
/* ------------------------------------------------------------------ */

export const COMPONENT_KINDS = [
  "web_frontend",
  "backend_service",
  "mobile_app",
  "desktop_app",
  "game",
  "3d_application",
  "library",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const TARGET_PLATFORMS = [
  "web",
  "ios",
  "android",
  "windows",
  "macos",
  "linux",
] as const;
export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

export const DEPLOYMENT_TARGET_TYPES = [
  "firebase_hosting",
  "cloud_run",
  "app_store",
  "play_store",
  "container_registry",
  "desktop_installer",
] as const;
export type DeploymentTargetType = (typeof DEPLOYMENT_TARGET_TYPES)[number];

/**
 * A reference to a credential held elsewhere (Secret Manager, a credential
 * registry, an alias). Never the credential itself.
 */
export interface CredentialReference {
  kind: "secret_manager" | "credential_id" | "alias";
  ref: string;
}

export interface ProjectComponentRequest {
  /** Stable, caller-chosen component id (e.g. `frontend`, `ios-app`). */
  id: string;
  kind: ComponentKind;
  platforms: readonly TargetPlatform[];
  /** Technology catalog ids (e.g. `react_typescript`, `swiftui`). */
  technologies: readonly string[];
}

export interface DeploymentIntent {
  componentId: string;
  targetType: DeploymentTargetType;
  stage: Environment;
  credentialRef?: CredentialReference;
}

export interface PlanningConstraints {
  destructiveMigration?: boolean;
  privilegedInfrastructure?: boolean;
}

/**
 * The structured planning input. Free text (`summary`) is informational only
 * and is never parsed into requirements. Server-owned facts (status, agents,
 * environments, approvals) are not part of the request and are dropped by
 * {@link normalizeProjectRequest}.
 */
export interface ProjectRequest {
  projectId: string;
  title: string;
  summary?: string;
  components: readonly ProjectComponentRequest[];
  deployments?: readonly DeploymentIntent[];
  constraints?: PlanningConstraints;
}

/* ------------------------------------------------------------------ */
/* Analysis, architecture, technologies                               */
/* ------------------------------------------------------------------ */

export interface TechnologyRequirement {
  componentId: string;
  technologyId: string;
  /** Toolchains (with minimum versions / components) that must be present. */
  toolchains: readonly ToolchainRequirement[];
  os?: { os?: OsName; architecture?: Architecture };
  capabilities: readonly CapabilityId[];
}

export interface AnalysedComponent {
  componentId: string;
  kind: ComponentKind;
  platforms: readonly TargetPlatform[];
  /** Technologies found in the catalog and compatible with the component. */
  technologyIds: readonly string[];
}

export interface UnsupportedTechnology {
  componentId: string;
  technologyId: string;
  reason:
    | "unknown_technology"
    | "incompatible_component_kind"
    | "incompatible_platform";
}

export interface TaskAnalysis {
  catalogVersion: string;
  components: readonly AnalysedComponent[];
  technologies: readonly TechnologyRequirement[];
  unsupportedTechnologies: readonly UnsupportedTechnology[];
}

export interface ArchitectureRequirement {
  style: "single_platform" | "multi_platform";
  layers: readonly ComponentKind[];
  platforms: readonly TargetPlatform[];
  components: readonly {
    componentId: string;
    kind: ComponentKind;
    platforms: readonly TargetPlatform[];
  }[];
}

/* ------------------------------------------------------------------ */
/* Environments                                                       */
/* ------------------------------------------------------------------ */

export interface PlannedEnvironmentRequirement {
  id: string;
  componentIds: readonly string[];
  requirement: EnvironmentRequirement;
  /** Whether a registered descriptor declares support (type support only). */
  descriptorSupport: "supported" | "unsupported";
  /** Evidence from the router over REAL instances. */
  match: EnvironmentMatchEvidence;
  status: "satisfied" | "missing";
}

/* ------------------------------------------------------------------ */
/* Agents and models                                                  */
/* ------------------------------------------------------------------ */

export const AGENT_REQUIREMENT_PURPOSES = [
  "build",
  "test",
  "security_review",
] as const;
export type AgentRequirementPurpose =
  (typeof AGENT_REQUIREMENT_PURPOSES)[number];

export interface AgentRequirement {
  id: string;
  purpose: AgentRequirementPurpose;
  componentIds: readonly string[];
  requiredCapabilities: readonly string[];
  modelCapabilities: readonly ModelCapability[];
}

export const AGENT_REJECTION_REASONS = [
  "agent_disabled",
  "project_not_allowed",
  "missing_capability",
] as const;
export type AgentRejectionReason = (typeof AGENT_REJECTION_REASONS)[number];

export interface AgentCandidateEvidence {
  agentId: string;
  qualifies: boolean;
  matchedCapabilities: readonly string[];
  missingCapabilities: readonly string[];
  reasonCodes: readonly AgentRejectionReason[];
}

export interface PlanAgentAssignment {
  requirementId: string;
  /** Stable agent id — never a display name. Absent when none qualifies. */
  agentId?: string;
  requiredCapabilities: readonly string[];
  matchedCapabilities: readonly string[];
  qualification: "qualified" | "none_qualified";
  candidates: readonly AgentCandidateEvidence[];
}

export const MODEL_CAPABILITIES = [
  "reasoning",
  "coding",
  "vision",
  "structured_output",
  "large_context",
] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

/** A DECLARED statement about what a provider/model supports. */
export interface ModelCapabilityProfile {
  id: string;
  providerId: string;
  model?: string;
  capabilities: readonly ModelCapability[];
}

export interface ModelRequirement {
  id: string;
  agentRequirementId: string;
  capabilities: readonly ModelCapability[];
  agentId?: string;
  eligibleProfileIds: readonly string[];
  missingCapabilities: readonly ModelCapability[];
  /** `not_evaluated` when no qualified agent exists to carry a model. */
  status: "satisfied" | "missing" | "not_evaluated";
}

/* ------------------------------------------------------------------ */
/* Dependencies                                                       */
/* ------------------------------------------------------------------ */

export interface DependencyRequirement {
  /** `toolchain:<kind>` or `toolchain:<kind>:<component>`. */
  id: string;
  kind: "toolchain" | "toolchain_component";
  toolchainKind: ToolchainKind;
  name: string;
  minimum?: VersionInfo;
  requiredBy: readonly string[];
  dependsOn: readonly string[];
}

export interface DependencyConflict {
  dependencyId: string;
  reason: "cycle" | "unknown_dependency";
}

export interface DependencyPlan {
  items: readonly DependencyRequirement[];
  /** Deterministic resolution order (topological, id tie-break). */
  order: readonly string[];
  conflicts: readonly DependencyConflict[];
}

/* ------------------------------------------------------------------ */
/* Stages — plans only, never results                                 */
/* ------------------------------------------------------------------ */

export interface ArtifactSpec {
  kind: string;
  name: string;
}

export interface BuildStage {
  id: string;
  componentId: string;
  status: "planned";
  inputs: readonly string[];
  environmentRequirementId: string;
  requiredCapabilities: readonly CapabilityId[];
  dependencyIds: readonly string[];
  agentRequirementId: string;
  expectedArtifact: ArtifactSpec;
  validation: readonly string[];
}

export const TEST_TYPES = [
  "unit",
  "integration",
  "ui",
  "e2e",
  "build_verification",
  "security",
  "platform_specific",
] as const;
export type TestType = (typeof TEST_TYPES)[number];

export interface TestStage {
  id: string;
  componentId: string;
  type: TestType;
  status: "planned";
  environmentRequirementId: string;
  dependsOnStageIds: readonly string[];
}

export const SECURITY_CHECKS = [
  "sast",
  "dependency_scan",
  "secret_scan",
  "permission_review",
  "security_agent_review",
] as const;
export type SecurityCheck = (typeof SECURITY_CHECKS)[number];

export interface SecurityStage {
  id: string;
  check: SecurityCheck;
  status: "planned";
  componentIds: readonly string[];
  agentRequirementId?: string;
}

export interface DeploymentRequirement {
  id: string;
  componentId: string;
  targetType: DeploymentTargetType;
  stage: Environment;
  status: "planned";
  requiredArtifact: ArtifactSpec;
  environmentRequirementId?: string;
  credentialRef?: CredentialReference;
  preDeploymentGates: readonly string[];
  rollbackRequired: boolean;
}

/* ------------------------------------------------------------------ */
/* Approvals and blockers                                             */
/* ------------------------------------------------------------------ */

export const PLAN_APPROVAL_REASONS = [
  "production_deployment",
  "destructive_migration",
  "privileged_infrastructure",
] as const;
export type PlanApprovalReason = (typeof PLAN_APPROVAL_REASONS)[number];

export interface PlanApprovalRequirement {
  id: string;
  reason: PlanApprovalReason;
  subjectIds: readonly string[];
}

/** Mirrors the authoritative `Approval` record; never set by a client. */
export interface PlanApprovalState {
  approvalId?: string;
  state: "not_requested" | "requested" | "approved" | "rejected" | "expired";
}

export const BLOCKER_CODES = [
  "MISSING_ENVIRONMENT",
  "MISSING_CAPABILITY",
  "MISSING_TOOLCHAIN",
  "UNSUPPORTED_TECHNOLOGY",
  "NO_QUALIFIED_AGENT",
  "DEPENDENCY_CONFLICT",
  "MISSING_MODEL_CAPABILITY",
  "APPROVAL_REJECTED",
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];

export interface ExecutionBlocker {
  code: BlockerCode;
  subjectType:
    | "environment"
    | "agent"
    | "model"
    | "dependency"
    | "technology"
    | "approval";
  subjectId: string;
  reasonCodes: readonly string[];
  missing: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Plan                                                               */
/* ------------------------------------------------------------------ */

export const PLAN_STATUSES = [
  "draft",
  "blocked",
  "ready",
  "awaiting_approval",
  "approved",
  "superseded",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const EXECUTION_PLAN_SCHEMA_VERSION = 1;

export interface ExecutionPlan {
  /** Document id: `${planId}@v${version}`. */
  id: string;
  /** Stable series id shared by every version of one plan. */
  planId: string;
  version: number;
  projectId: string;
  status: PlanStatus;
  schemaVersion: typeof EXECUTION_PLAN_SCHEMA_VERSION;
  request: ProjectRequest;
  analysis: TaskAnalysis;
  architecture: ArchitectureRequirement;
  environments: readonly PlannedEnvironmentRequirement[];
  agentRequirements: readonly AgentRequirement[];
  agents: readonly PlanAgentAssignment[];
  models: readonly ModelRequirement[];
  dependencies: DependencyPlan;
  build: readonly BuildStage[];
  tests: readonly TestStage[];
  security: readonly SecurityStage[];
  deployment: readonly DeploymentRequirement[];
  approvalRequirements: readonly PlanApprovalRequirement[];
  approval: PlanApprovalState;
  blockers: readonly ExecutionBlocker[];
  /** SHA-256 of the canonical planning inputs (request + registry + agents + policy). */
  inputsFingerprint: string;
  supersedes?: string;
  supersededBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Cost planning is a later capability — never a fabricated estimate. */
  cost: { status: "not_estimated" };
}

/** Allowed lifecycle transitions. Anything else is a `StateTransitionError`. */
export const PLAN_TRANSITIONS: Readonly<
  Record<PlanStatus, readonly PlanStatus[]>
> = {
  draft: ["blocked", "ready"],
  blocked: ["superseded"],
  ready: ["awaiting_approval", "superseded"],
  awaiting_approval: ["approved", "blocked", "superseded"],
  approved: ["superseded"],
  superseded: [],
};

export function canTransitionPlan(from: PlanStatus, to: PlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ */
/* Validation / normalization                                         */
/* ------------------------------------------------------------------ */

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SECRET_MANAGER_REF =
  /^projects\/[a-z0-9-]{1,64}\/secrets\/[A-Za-z0-9_-]{1,255}(\/versions\/(latest|\d{1,6}))?$/;
const PLAIN_REF = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const MAX_COMPONENTS = 20;
const MAX_TECHNOLOGIES = 10;
const MAX_TEXT = 2000;

export function validateCredentialReference(
  ref: CredentialReference,
  field = "credentialRef",
): CredentialReference {
  if (!ref || typeof ref !== "object") {
    throw new ValidationError(`${field} must be an object`);
  }
  const value = requireText(ref.ref, `${field}.ref`);
  if (ref.kind === "secret_manager") {
    if (!SECRET_MANAGER_REF.test(value)) {
      throw new ValidationError(
        `${field}.ref must be a Secret Manager resource name`,
      );
    }
  } else if (ref.kind === "credential_id" || ref.kind === "alias") {
    if (!PLAIN_REF.test(value)) {
      throw new ValidationError(
        `${field}.ref must be a short lowercase identifier`,
      );
    }
  } else {
    throw new ValidationError(
      `${field}.kind must be secret_manager, credential_id or alias`,
    );
  }
  return { kind: ref.kind, ref: value };
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function stableId(value: unknown, field: string): string {
  const id = requireText(value, field);
  if (!ID_PATTERN.test(id)) {
    throw new ValidationError(
      `${field} must be lowercase letters, digits, "-" or "_" (max 64)`,
    );
  }
  return id;
}

function boundedText(value: unknown, field: string): string {
  const text = requireText(value, field);
  if (text.length > MAX_TEXT) {
    throw new ValidationError(`${field} must be at most ${MAX_TEXT} chars`);
  }
  return text;
}

/**
 * Validate an untrusted planning request and return a normalized copy that
 * contains ONLY the known request fields. Anything a client might try to
 * smuggle in — a status, an agent id, an environment id, an approval state —
 * is dropped, because those are always derived server-side.
 */
export function normalizeProjectRequest(input: unknown): ProjectRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("planning request must be an object");
  }
  const raw = input as Record<string, unknown>;
  const projectId = requireText(raw.projectId, "request.projectId");
  const title = boundedText(raw.title, "request.title");
  const summary =
    raw.summary === undefined
      ? undefined
      : boundedText(raw.summary, "request.summary");

  const componentsRaw = requireArray(raw.components, "request.components");
  if (componentsRaw.length === 0 || componentsRaw.length > MAX_COMPONENTS) {
    throw new ValidationError(
      `request.components must contain 1–${MAX_COMPONENTS} components`,
    );
  }
  const seen = new Set<string>();
  const components = componentsRaw.map((entry, index) => {
    const field = `request.components[${index}]`;
    if (!entry || typeof entry !== "object") {
      throw new ValidationError(`${field} must be an object`);
    }
    const c = entry as Record<string, unknown>;
    const id = stableId(c.id, `${field}.id`);
    if (seen.has(id)) {
      throw new ValidationError(`${field}.id "${id}" is duplicated`);
    }
    seen.add(id);
    const platforms = requireArray(c.platforms, `${field}.platforms`).map(
      (p, i) => oneOf(p, TARGET_PLATFORMS, `${field}.platforms[${i}]`),
    );
    if (platforms.length === 0) {
      throw new ValidationError(`${field}.platforms must not be empty`);
    }
    const technologies = requireArray(
      c.technologies,
      `${field}.technologies`,
    ).map((t, i) => stableId(t, `${field}.technologies[${i}]`));
    if (technologies.length === 0 || technologies.length > MAX_TECHNOLOGIES) {
      throw new ValidationError(
        `${field}.technologies must contain 1–${MAX_TECHNOLOGIES} entries`,
      );
    }
    const component: ProjectComponentRequest = {
      id,
      kind: oneOf(c.kind, COMPONENT_KINDS, `${field}.kind`),
      platforms: [...new Set(platforms)],
      technologies: [...new Set(technologies)],
    };
    return component;
  });

  let deployments: DeploymentIntent[] | undefined;
  if (raw.deployments !== undefined) {
    deployments = requireArray(raw.deployments, "request.deployments").map(
      (entry, index) => {
        const field = `request.deployments[${index}]`;
        if (!entry || typeof entry !== "object") {
          throw new ValidationError(`${field} must be an object`);
        }
        const d = entry as Record<string, unknown>;
        const componentId = stableId(d.componentId, `${field}.componentId`);
        if (!seen.has(componentId)) {
          throw new ValidationError(
            `${field}.componentId references an unknown component`,
          );
        }
        const intent: DeploymentIntent = {
          componentId,
          targetType: oneOf(
            d.targetType,
            DEPLOYMENT_TARGET_TYPES,
            `${field}.targetType`,
          ),
          stage: oneOf(d.stage, ENVIRONMENTS, `${field}.stage`),
        };
        if (d.credentialRef !== undefined) {
          intent.credentialRef = validateCredentialReference(
            d.credentialRef as CredentialReference,
            `${field}.credentialRef`,
          );
        }
        return intent;
      },
    );
  }

  let constraints: PlanningConstraints | undefined;
  if (raw.constraints !== undefined) {
    if (!raw.constraints || typeof raw.constraints !== "object") {
      throw new ValidationError("request.constraints must be an object");
    }
    const c = raw.constraints as Record<string, unknown>;
    constraints = {};
    for (const key of [
      "destructiveMigration",
      "privilegedInfrastructure",
    ] as const) {
      if (c[key] !== undefined) {
        if (typeof c[key] !== "boolean") {
          throw new ValidationError(
            `request.constraints.${key} must be boolean`,
          );
        }
        constraints[key] = c[key];
      }
    }
  }

  return {
    projectId,
    title,
    ...(summary !== undefined ? { summary } : {}),
    components,
    ...(deployments !== undefined ? { deployments } : {}),
    ...(constraints !== undefined ? { constraints } : {}),
  };
}

export function validateModelCapabilityProfile(
  profile: ModelCapabilityProfile,
): void {
  requireText(profile.id, "modelProfile.id");
  requireText(profile.providerId, "modelProfile.providerId");
  requireArray(profile.capabilities, "modelProfile.capabilities").forEach(
    (c, i) => oneOf(c, MODEL_CAPABILITIES, `modelProfile.capabilities[${i}]`),
  );
}

/** Structural check of a stored/produced plan. Never invents missing fields. */
export function validateExecutionPlan(plan: ExecutionPlan): void {
  if (!plan || typeof plan !== "object") {
    throw new ValidationError("execution plan must be an object");
  }
  requireText(plan.id, "plan.id");
  requireText(plan.planId, "plan.planId");
  requireText(plan.projectId, "plan.projectId");
  if (!Number.isInteger(plan.version) || plan.version < 1) {
    throw new ValidationError("plan.version must be a positive integer");
  }
  if (plan.id !== `${plan.planId}@v${plan.version}`) {
    throw new ValidationError("plan.id must equal `${planId}@v${version}`");
  }
  oneOf(plan.status, PLAN_STATUSES, "plan.status");
  if (plan.schemaVersion !== EXECUTION_PLAN_SCHEMA_VERSION) {
    throw new ValidationError("plan.schemaVersion is not supported");
  }
  normalizeProjectRequest(plan.request);
  if (plan.request.projectId !== plan.projectId) {
    throw new ValidationError("plan.request.projectId must match the plan");
  }
  for (const key of [
    "environments",
    "agentRequirements",
    "agents",
    "models",
    "build",
    "tests",
    "security",
    "deployment",
    "approvalRequirements",
    "blockers",
  ] as const) {
    requireArray(plan[key], `plan.${key}`);
  }
  for (const stage of [
    ...plan.build,
    ...plan.tests,
    ...plan.security,
    ...plan.deployment,
  ]) {
    if (stage.status !== "planned") {
      throw new ValidationError("plan stages may only be `planned`");
    }
  }
  plan.blockers.forEach((b, i) =>
    oneOf(b.code, BLOCKER_CODES, `plan.blockers[${i}].code`),
  );
  if (!plan.dependencies || typeof plan.dependencies !== "object") {
    throw new ValidationError("plan.dependencies must be an object");
  }
  requireArray(plan.dependencies.items, "plan.dependencies.items");
  requireArray(plan.dependencies.order, "plan.dependencies.order");
  requireArray(plan.dependencies.conflicts, "plan.dependencies.conflicts");
  if (plan.status === "blocked" && plan.blockers.length === 0) {
    throw new ValidationError("a blocked plan must carry at least one blocker");
  }
  if (
    (plan.status === "ready" ||
      plan.status === "awaiting_approval" ||
      plan.status === "approved") &&
    plan.blockers.length > 0
  ) {
    throw new ValidationError(`a ${plan.status} plan must not have blockers`);
  }
  plan.deployment.forEach((d, i) => {
    if (d.credentialRef) {
      validateCredentialReference(
        d.credentialRef,
        `plan.deployment[${i}].credentialRef`,
      );
    }
  });
  requireText(plan.inputsFingerprint, "plan.inputsFingerprint");
  requireText(plan.createdBy, "plan.createdBy");
  requireText(plan.createdAt, "plan.createdAt");
  if (plan.cost?.status !== "not_estimated") {
    throw new ValidationError("plan.cost must be `not_estimated`");
  }
}
