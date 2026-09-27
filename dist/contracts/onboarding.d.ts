/**
 * Project onboarding & provisioning contracts (PROJECT-2).
 *
 * The complete flow is
 *   draft → source → analysis → provisioning plan → human review → approval
 *         → provisioning (idempotent, step-tracked) → validation → READY
 * and every arrow is a governed Control Plane command. The browser never
 * writes any of this state.
 *
 * Non-negotiable distinctions encoded in the types below:
 *   DISCOVERED != APPROVED            (analysis is evidence, not a decision)
 *   PLANNED != EXECUTED               (a plan step is not a resource)
 *   APPROVED PLAN != PROVISIONED      (steps run and can fail)
 *   PROJECT CREATED != PROJECT READY  (READY is a validated gate)
 *   AVAILABLE != QUALIFIED            (environments / agents)
 *   SECRET REFERENCE != SECRET VALUE  (only variable NAMES appear anywhere)
 *   CONFIGURED != DEPLOYED            (deployment is modelled, never faked)
 */
import type { Entity } from "./index.js";
export declare const ONBOARDING_MODES: readonly ["guided", "auto"];
export type OnboardingMode = (typeof ONBOARDING_MODES)[number];
export declare const ONBOARDING_KINDS: readonly ["create_new", "import_existing", "import_local"];
export type OnboardingKind = (typeof ONBOARDING_KINDS)[number];
/**
 * Source providers. Only providers with `available: true` may be selected;
 * the rest are declared so the contract is future-extensible without faking
 * an integration that does not exist.
 */
export declare const SOURCE_PROVIDERS: readonly ["github", "gitlab", "bitbucket", "azure_devops", "local_workspace", "source_bundle", "template", "existing_project"];
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];
export interface SourceProviderStatus {
    provider: SourceProvider;
    available: boolean;
    /** Why it is unavailable (or a caveat when available). Always honest. */
    note: string;
}
export declare const ONBOARDING_STATUSES: readonly ["draft", "source_configured", "analyzing", "analyzed", "planning", "review_required", "approved", "provisioning", "validating", "ready", "analysis_failed", "provisioning_failed", "validation_failed", "cancelled"];
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
/**
 * The deterministic lifecycle. A failure state is explicit and recoverable
 * where it is safe: analysis may be retried, provisioning may be resumed,
 * validation may be re-run. `ready` and `cancelled` are terminal.
 */
export declare const ONBOARDING_TRANSITIONS: Readonly<Record<OnboardingStatus, readonly OnboardingStatus[]>>;
export declare function canTransitionOnboarding(from: OnboardingStatus, to: OnboardingStatus): boolean;
/** Statuses in which the draft (identity/source/overrides) may still change. */
export declare const EDITABLE_ONBOARDING_STATUSES: readonly OnboardingStatus[];
export declare const TERMINAL_ONBOARDING_STATUSES: readonly OnboardingStatus[];
export declare const PROJECT_PRIORITIES: readonly ["low", "normal", "high", "critical"];
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];
export interface OnboardingIdentity {
    /** Mutable display name. */
    name: string;
    fullName?: string;
    /** Short unique code, upper-case, 2–12 chars. */
    code: string;
    description?: string;
    applicationType?: string;
    priority: ProjectPriority;
    /** Operator id of the business owner (defaults to the requester). */
    owner: string;
    objective?: string;
}
export interface OnboardingSource {
    provider: SourceProvider;
    /** Credential-free https repository URL (import_existing). */
    repositoryUrl?: string;
    /** Branch to analyse; defaults to the repository default branch. */
    branch?: string;
    /** Requirements/specification text (create_new). */
    specification?: string;
    /** New project only: ask for a repository to be provisioned. */
    createRepository?: boolean;
}
/** A deliberate divergence from a recommendation, recorded and audited. */
export interface OnboardingOverride {
    field: string;
    value: string;
    recommended?: string;
    reason?: string;
}
export interface OnboardingDraft {
    identity: OnboardingIdentity;
    source: OnboardingSource;
    overrides: readonly OnboardingOverride[];
    autonomyLevel: AutonomyLevel;
    gitPolicy?: Partial<GitPolicy>;
    costPolicy?: Partial<CostPolicy>;
}
export type EvidenceConfidence = "high" | "medium" | "low";
/** One fact with the evidence that supports it. No evidence → no finding. */
export interface Finding {
    value: string;
    evidence: string;
    confidence: EvidenceConfidence;
}
export interface CommandFinding {
    /** install | typecheck | lint | test | build | start | deploy | other. */
    purpose: string;
    command: string;
    evidence: string;
}
export declare const ENV_VAR_CLASSES: readonly ["public_client", "server_secret", "build_secret", "runtime_secret", "unclassified"];
export type EnvVarClass = (typeof ENV_VAR_CLASSES)[number];
/** Only a NAME and its classification — a value is never captured. */
export interface EnvVarFinding {
    name: string;
    classification: EnvVarClass;
    evidence: string;
}
export declare const ANALYSIS_SEVERITIES: readonly ["info", "warning", "blocker"];
export type AnalysisSeverity = (typeof ANALYSIS_SEVERITIES)[number];
/** FINDING != AUTOMATIC CHANGE: a finding is reported, never auto-fixed. */
export interface ArchitectureFinding {
    code: string;
    severity: AnalysisSeverity;
    message: string;
    evidence?: string;
}
export interface ProjectStructure {
    frontend: Finding[];
    backend: Finding[];
    api: Finding[];
    database: Finding[];
    authentication: Finding[];
    storage: Finding[];
    functions: Finding[];
    infrastructure: Finding[];
    tests: Finding[];
    deployment: Finding[];
    documentation: Finding[];
    ci: Finding[];
}
export interface DependencySummary {
    manifests: string[];
    runtimeCount?: number;
    devCount?: number;
    /** Findings/recommendations only — nothing is upgraded during onboarding. */
    notes: string[];
}
export interface DocumentationRef {
    path: string;
    kind: "readme" | "architecture" | "adr" | "standards" | "docs";
}
export interface RepositoryBaseline {
    provider?: SourceProvider;
    repositoryUrl?: string;
    visibility?: "public" | "private" | "unknown";
    defaultBranch?: string;
    branch?: string;
    /** Commit the analysis is based on. Unavailable → `undefined`. */
    commit?: string;
}
export interface ProjectAnalysis {
    /** `repository` = read from source evidence; `specification` = proposed. */
    basis: "repository" | "specification";
    generatedAt: string;
    repository: RepositoryBaseline;
    applicationKinds: Finding[];
    languages: Finding[];
    frameworks: Finding[];
    packageManagers: Finding[];
    buildSystems: Finding[];
    structure: ProjectStructure;
    dependencies: DependencySummary;
    commands: CommandFinding[];
    testFrameworks: Finding[];
    coverageConfigured: boolean | "unknown";
    deployment: Finding[];
    envVars: EnvVarFinding[];
    security: ArchitectureFinding[];
    documentation: DocumentationRef[];
    findings: ArchitectureFinding[];
    /** Things that could not be determined — reported, never guessed. */
    unavailable: string[];
    /** True when the file listing was truncated by the source provider. */
    truncated: boolean;
}
export declare const AUTONOMY_LEVELS: readonly [1, 2, 3, 4, 5];
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
/**
 * Capabilities are authoritative; the numeric level only selects a preset
 * that is intersected with what the platform actually allows. A level is
 * never a security bypass.
 */
export declare const PROJECT_CAPABILITIES: readonly ["repository.read", "repository.write", "branch.create", "tests.run", "commit.create", "push", "pull_request.create", "merge", "deployment.staging", "deployment.production"];
export type ProjectPolicyCapability = (typeof PROJECT_CAPABILITIES)[number];
export interface AutonomyPolicy {
    level: AutonomyLevel;
    /** Capabilities the level *requests*. */
    requested: ProjectPolicyCapability[];
    /** Capabilities actually granted at provisioning (a subset). */
    granted: ProjectPolicyCapability[];
    /** Capabilities that always require an approval, at any level. */
    approvalRequired: string[];
    note: string;
}
export interface GitPolicy {
    defaultBranch?: string;
    developmentBranch?: string;
    /** e.g. `agent/<task-id>`. */
    agentBranchPattern: string;
    testsRequired: boolean;
    reviewRequired: boolean;
    securityCheckRequired: boolean;
    autoCommit: boolean;
    autoPush: boolean;
    pullRequestRequired: boolean;
    /** `manual` = a human merges; agents never merge autonomously by default. */
    mergePolicy: "manual" | "approved_only";
    allowDirectDefaultBranchWrites: boolean;
}
export declare const PIPELINE_STAGES: readonly ["install", "typecheck", "lint", "test", "build", "security", "smoke"];
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export interface PipelineStep {
    stage: PipelineStage;
    /** `unresolved` = no repository evidence — a command is never invented. */
    status: "resolved" | "unresolved";
    command?: string;
    evidence?: string;
}
export interface TechnologyPlan {
    origin: "detected" | "proposed";
    languages: Finding[];
    frameworks: Finding[];
    dataStorage: Finding[];
    authentication: Finding[];
    packageManagers: Finding[];
    buildSystems: Finding[];
    testSystems: Finding[];
    deploymentTargets: Finding[];
    overrides: OnboardingOverride[];
}
export interface ArchitectureComponent {
    kind: string;
    name: string;
    evidence: string;
}
export interface ArchitecturePlan {
    summary: string;
    components: ArchitectureComponent[];
    findings: ArchitectureFinding[];
}
export interface EnvironmentPlanItem {
    descriptorId?: string;
    environmentType: string;
    purpose: string;
    requirements: string[];
    /** Declared support (descriptor) — never confused with availability. */
    supported: boolean;
    /** Real registry state: is a qualified, usable instance registered? */
    availability: "qualified_instance_available" | "no_qualified_instance" | "unsupported";
    provisioningNeed: string;
}
export interface WorkforcePlanItem {
    role: string;
    /** Registered agent id, when a real production agent exists for the role. */
    agentId?: string;
    /** `roadmap` = a role the platform does not implement yet. */
    availability: "registered" | "roadmap";
    /** AVAILABLE != QUALIFIED. */
    qualified: boolean;
    reason: string;
}
export declare const INTEGRATION_STATES: readonly ["connected", "required", "optional", "unavailable", "needs_authorization"];
export type IntegrationState = (typeof INTEGRATION_STATES)[number];
export interface IntegrationPlanItem {
    provider: string;
    purpose: string;
    state: IntegrationState;
    note: string;
}
export interface SecretRequirement {
    name: string;
    classification: EnvVarClass;
    /** Status only. `missing` = no broker binding yet. The value is never held. */
    status: "reference_required";
    evidence?: string;
}
export interface DeploymentTargetPlan {
    /** `unspecified` = the repository shows a target but not which stage it is. */
    environment: "development" | "staging" | "production" | "unspecified";
    provider: string;
    origin: "detected" | "proposed";
    /** CONFIGURED != DEPLOYED. */
    state: "modelled_not_deployed";
    buildCommand?: string;
    evidence?: string;
    healthCheck?: string;
}
export interface DeploymentPlan {
    targets: DeploymentTargetPlan[];
    /** Operational objective: validated deployment visible within N minutes. */
    visibilitySlaMinutes: number;
    slaNote: string;
    existingDeploymentPreserved: boolean;
}
export interface CostPolicy {
    dailyLimit?: number;
    monthlyLimit?: number;
    taskLimit?: number;
    /** Percent of a limit at which a warning is raised (1–100). */
    warningThresholdPercent: number;
    hardStop: boolean;
    currency: "USD";
    /**
     * Whether the platform enforces this server-side today. Honest gap
     * reporting: recording a policy is not enforcing it.
     */
    enforcement: "not_enforced";
    enforcementNote: string;
}
export interface KnowledgeRef {
    path: string;
    kind: DocumentationRef["kind"];
}
export interface PlanIssue {
    code: string;
    message: string;
}
export declare const PLANNED_STEP_KEYS: readonly ["registry_entry", "repository_binding", "repository_creation", "environment_profile", "agent_policy", "integration_policies", "secret_requirements", "git_workflow", "build_test_pipeline", "deployment_configuration", "firebase_provisioning", "cost_policy", "audit_baseline", "project_knowledge"];
export type PlannedStepKey = (typeof PLANNED_STEP_KEYS)[number];
export interface PlannedStep {
    key: PlannedStepKey;
    title: string;
    /** external = would touch a resource outside the Control Plane. */
    external: boolean;
    /** Mandatory steps must pass for the project to become READY. */
    mandatory: boolean;
    /** What the step will do, or why it cannot be executed truthfully. */
    description: string;
    /** `pending_requirement` = declared, cannot be executed by this platform. */
    executable: boolean;
}
/**
 * The immutable, versioned unit that is reviewed and approved. `planHash` is
 * a digest of the canonical plan content: an approval binds to it, so a
 * changed plan can never inherit an earlier approval.
 */
export interface ProvisioningPlan {
    planVersion: number;
    planHash: string;
    generatedAt: string;
    basis: ProjectAnalysis["basis"];
    identity: OnboardingIdentity & {
        projectId: string;
    };
    source: OnboardingSource;
    repository: RepositoryBaseline;
    technology: TechnologyPlan;
    architecture: ArchitecturePlan;
    environments: EnvironmentPlanItem[];
    workforce: WorkforcePlanItem[];
    autonomy: AutonomyPolicy;
    integrations: IntegrationPlanItem[];
    secrets: SecretRequirement[];
    git: GitPolicy;
    pipeline: PipelineStep[];
    deployment: DeploymentPlan;
    cost: CostPolicy;
    governance: {
        auditBaseline: string[];
        approvals: string[];
        securityFindings: number;
    };
    knowledge: KnowledgeRef[];
    steps: PlannedStep[];
    blockers: PlanIssue[];
    warnings: PlanIssue[];
}
export interface PlanApproval {
    planVersion: number;
    planHash: string;
    approvedBy: string;
    approvedAt: string;
}
export declare const STEP_STATUSES: readonly ["pending", "running", "complete", "failed", "skipped", "requirement_pending"];
export type StepStatus = (typeof STEP_STATUSES)[number];
export interface ProvisioningStepRecord {
    key: PlannedStepKey;
    title: string;
    status: StepStatus;
    mandatory: boolean;
    external: boolean;
    startedAt?: string;
    completedAt?: string;
    /** Safe, human-readable detail. Never a secret. */
    detail?: string;
    error?: string;
}
export interface ProvisioningRun {
    /** Bound to the approved plan. */
    planVersion: number;
    planHash: string;
    attempt: number;
    startedAt: string;
    updatedAt: string;
    steps: ProvisioningStepRecord[];
}
export interface ValidationCheck {
    key: string;
    title: string;
    mandatory: boolean;
    passed: boolean;
    detail: string;
}
export interface ValidationReport {
    checkedAt: string;
    ready: boolean;
    checks: ValidationCheck[];
    /** The mandatory checks that block READY. */
    blocking: string[];
}
export interface OnboardingFailure {
    code: string;
    message: string;
    at: string;
    step?: PlannedStepKey;
}
/** The authoritative onboarding record (`onboarding_sessions/{id}`). */
export interface OnboardingSession extends Entity {
    id: string;
    /** Stable, immutable internal project id (server-generated). */
    projectId: string;
    requestedBy: string;
    mode: OnboardingMode;
    kind: OnboardingKind;
    status: OnboardingStatus;
    draft: OnboardingDraft;
    analysis?: ProjectAnalysis;
    plan?: ProvisioningPlan;
    approval?: PlanApproval;
    provisioning?: ProvisioningRun;
    validation?: ValidationReport;
    failure?: OnboardingFailure;
    createdAt: string;
    updatedAt: string;
    /** Optimistic-concurrency counter; bumped on every committed change. */
    revision: number;
    /** Monotonic plan counter, kept even when a plan is invalidated. */
    planVersionCounter?: number;
}
/** The registered, READY (or blocked) project produced by provisioning. */
export interface ProvisionedProject extends Entity {
    id: string;
    code: string;
    displayName: string;
    fullName?: string;
    description?: string;
    onboardingId: string;
    createdBy: string;
    createdAt: string;
    readiness: "ready" | "blocked";
    repository?: RepositoryBaseline;
    /** Canonical repository key used for duplicate-binding protection. */
    repositoryKey?: string;
    plan: ProvisioningPlan;
    baseline: AuditBaseline;
    blocking: string[];
    revision: number;
}
/** AI Auditor baseline. Every field is real or `Unavailable`. */
export interface AuditBaseline {
    establishedAt: string;
    repositoryCommit: string;
    branch: string;
    architectureRevision: string;
    dependencySummary: string;
    testStatus: string;
    securityFindings: string;
    deploymentState: string;
}
export declare const UNAVAILABLE = "Unavailable \u2014 not established";
export interface OnboardingSessionStore {
    get(id: string): Promise<OnboardingSession | undefined>;
    list(): Promise<OnboardingSession[]>;
    /** Create-only: `false` when the id already exists. */
    create(session: OnboardingSession): Promise<boolean>;
    /**
     * Replace iff the stored revision equals `expectedRevision`. Returns
     * `false` on a lost race (the caller reports a conflict).
     */
    replace(session: OnboardingSession, expectedRevision: number): Promise<boolean>;
}
export type ProvisionedProjectCommit = {
    result: "created";
} | {
    result: "exists";
    sameOnboarding: boolean;
} | {
    result: "conflict";
    reason: "code" | "repository";
};
export interface ProvisionedProjectStore {
    get(id: string): Promise<ProvisionedProject | undefined>;
    list(): Promise<ProvisionedProject[]>;
    /**
     * Atomically claim the immutable project id, the unique project code and
     * (when present) the repository key, then create the record. Idempotent for
     * the same onboarding id.
     */
    create(project: ProvisionedProject): Promise<ProvisionedProjectCommit>;
    /** Replace after validation flips readiness (revision-checked). */
    replace(project: ProvisionedProject, expectedRevision: number): Promise<boolean>;
}
export interface OnboardingSessionSummary {
    id: string;
    projectId: string;
    name: string;
    code: string;
    mode: OnboardingMode;
    kind: OnboardingKind;
    status: OnboardingStatus;
    requestedBy: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}
/** `GET /api/onboarding/capabilities`. */
export interface OnboardingCapabilitiesView {
    canCreate: boolean;
    providers: SourceProviderStatus[];
    kinds: {
        kind: OnboardingKind;
        available: boolean;
        note: string;
    }[];
    /** Honest platform gaps shown in the wizard. */
    gaps: {
        key: string;
        note: string;
    }[];
}
export declare const ONBOARDING_COMMANDS: readonly ["onboarding_create", "onboarding_update", "onboarding_analyze", "onboarding_plan", "onboarding_approve_plan", "onboarding_provision", "onboarding_revalidate", "onboarding_cancel"];
export type OnboardingCommand = (typeof ONBOARDING_COMMANDS)[number];
export declare const PROJECT_CODE_PATTERN: RegExp;
export declare const PROJECT_ID_PATTERN: RegExp;
