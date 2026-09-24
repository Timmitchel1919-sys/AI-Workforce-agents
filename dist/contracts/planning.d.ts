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
import { type Environment } from "./index.js";
import { type Architecture, type CapabilityId, type EnvironmentMatchEvidence, type EnvironmentRequirement, type OsName, type ToolchainKind, type ToolchainRequirement, type VersionInfo } from "./environments.js";
export declare const COMPONENT_KINDS: readonly ["web_frontend", "backend_service", "mobile_app", "desktop_app", "game", "3d_application", "library"];
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
export declare const TARGET_PLATFORMS: readonly ["web", "ios", "android", "windows", "macos", "linux"];
export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];
export declare const DEPLOYMENT_TARGET_TYPES: readonly ["firebase_hosting", "cloud_run", "app_store", "play_store", "container_registry", "desktop_installer"];
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
export interface TechnologyRequirement {
    componentId: string;
    technologyId: string;
    /** Toolchains (with minimum versions / components) that must be present. */
    toolchains: readonly ToolchainRequirement[];
    os?: {
        os?: OsName;
        architecture?: Architecture;
    };
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
    reason: "unknown_technology" | "incompatible_component_kind" | "incompatible_platform";
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
export declare const AGENT_REQUIREMENT_PURPOSES: readonly ["build", "test", "security_review"];
export type AgentRequirementPurpose = (typeof AGENT_REQUIREMENT_PURPOSES)[number];
export interface AgentRequirement {
    id: string;
    purpose: AgentRequirementPurpose;
    componentIds: readonly string[];
    requiredCapabilities: readonly string[];
    modelCapabilities: readonly ModelCapability[];
}
export declare const AGENT_REJECTION_REASONS: readonly ["agent_disabled", "project_not_allowed", "missing_capability"];
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
export declare const MODEL_CAPABILITIES: readonly ["reasoning", "coding", "vision", "structured_output", "large_context"];
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
export declare const TEST_TYPES: readonly ["unit", "integration", "ui", "e2e", "build_verification", "security", "platform_specific"];
export type TestType = (typeof TEST_TYPES)[number];
export interface TestStage {
    id: string;
    componentId: string;
    type: TestType;
    status: "planned";
    environmentRequirementId: string;
    dependsOnStageIds: readonly string[];
}
export declare const SECURITY_CHECKS: readonly ["sast", "dependency_scan", "secret_scan", "permission_review", "security_agent_review"];
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
export declare const PLAN_APPROVAL_REASONS: readonly ["production_deployment", "destructive_migration", "privileged_infrastructure"];
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
export declare const BLOCKER_CODES: readonly ["MISSING_ENVIRONMENT", "MISSING_CAPABILITY", "MISSING_TOOLCHAIN", "UNSUPPORTED_TECHNOLOGY", "NO_QUALIFIED_AGENT", "DEPENDENCY_CONFLICT", "MISSING_MODEL_CAPABILITY", "APPROVAL_REJECTED"];
export type BlockerCode = (typeof BLOCKER_CODES)[number];
export interface ExecutionBlocker {
    code: BlockerCode;
    subjectType: "environment" | "agent" | "model" | "dependency" | "technology" | "approval";
    subjectId: string;
    reasonCodes: readonly string[];
    missing: readonly string[];
}
export declare const PLAN_STATUSES: readonly ["draft", "blocked", "ready", "awaiting_approval", "approved", "superseded"];
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export declare const EXECUTION_PLAN_SCHEMA_VERSION = 1;
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
    cost: {
        status: "not_estimated";
    };
}
/** Allowed lifecycle transitions. Anything else is a `StateTransitionError`. */
export declare const PLAN_TRANSITIONS: Readonly<Record<PlanStatus, readonly PlanStatus[]>>;
export declare function canTransitionPlan(from: PlanStatus, to: PlanStatus): boolean;
export declare function validateCredentialReference(ref: CredentialReference, field?: string): CredentialReference;
/**
 * Validate an untrusted planning request and return a normalized copy that
 * contains ONLY the known request fields. Anything a client might try to
 * smuggle in — a status, an agent id, an environment id, an approval state —
 * is dropped, because those are always derived server-side.
 */
export declare function normalizeProjectRequest(input: unknown): ProjectRequest;
export declare function validateModelCapabilityProfile(profile: ModelCapabilityProfile): void;
/** Structural check of a stored/produced plan. Never invents missing fields. */
export declare function validateExecutionPlan(plan: ExecutionPlan): void;
