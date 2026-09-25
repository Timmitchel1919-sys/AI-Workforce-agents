import type { ApprovalRiskLevel } from "./control.js";
import type { CapabilityId } from "./environments.js";
import type { FileChangeEvidence } from "./workspace.js";
import type { EnvironmentExecutionEvidence, EnvironmentOperationRequirement } from "./environment-adapters.js";
/** Hard ceiling for one structured text input (e.g. file content). */
export declare const MAX_INVOCATION_TEXT_BYTES: number;
/** Reject properties that are not part of a contract (no smuggled fields). */
export declare function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void;
export declare function requireExecutionId(value: unknown, field: string): string;
/**
 * Well-known secret value shapes (API keys, GitHub/Slack tokens, AWS keys,
 * PEM private keys). Single source for Control Plane redaction and execution
 * output/receipt redaction.
 */
export declare const KNOWN_SECRET_VALUE_PATTERN: RegExp;
/**
 * Execution risk extends `ApprovalRiskLevel` (low/medium/high) with
 * `critical`. A risk is always declared server-side on the registered
 * operation; a request can never carry or lower it.
 */
export declare const EXECUTION_RISK_LEVELS: readonly ["low", "medium", "high", "critical"];
export type ExecutionRiskLevel = (typeof EXECUTION_RISK_LEVELS)[number];
export declare const EXECUTION_RISK_RANK: Readonly<Record<ExecutionRiskLevel, number>>;
export declare function riskAtLeast(risk: ExecutionRiskLevel, threshold: ExecutionRiskLevel): boolean;
/** Map onto the approval queue's risk levels (critical → high). */
export declare function toApprovalRisk(risk: ExecutionRiskLevel): ApprovalRiskLevel;
/**
 * What ONE execution session may do. Distinct from an agent's general
 * capabilities/permissions: a broadly qualified agent receives none of these
 * unless a policy rule grants them to a specific session. Capabilities never
 * imply each other (repository.write ⇏ repository.push, build ⇏ deploy).
 */
export declare const EXECUTION_CAPABILITIES: readonly ["filesystem.read", "filesystem.write.workspace", "filesystem.delete.workspace", "filesystem.write.protected", "repository.read", "repository.write", "repository.commit", "repository.push", "repository.branch.manage", "process.invoke.bounded", "network.outbound.allowed-host", "artifact.write", "test.invoke", "build.invoke", "security.scan.invoke", "deploy.invoke", "secret.reference.use"];
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];
export declare function isExecutionCapability(value: unknown): value is ExecutionCapability;
/**
 * Normalized execution outcomes. Denials are EXPECTED security outcomes —
 * they are returned as data (pre-flight `DENIED`), never as HTTP 500.
 */
export declare const EXECUTION_ERROR_CODES: readonly ["POLICY_DENIED", "AUTHORIZATION_DENIED", "APPROVAL_REQUIRED", "STALE_PLAN", "PLAN_NOT_EXECUTABLE", "AGENT_NOT_QUALIFIED", "ENVIRONMENT_UNAVAILABLE", "WORKSPACE_VIOLATION", "TOOL_NOT_ALLOWED", "INVALID_TOOL_INPUT", "SANDBOX_UNAVAILABLE", "RESOURCE_LIMIT", "TIMEOUT", "CANCELLED", "SANDBOX_FAILURE", "INTERNAL_ERROR", "CAPABILITY_NOT_GRANTED", "INVALID_OUTPUT", "WORKSPACE_CONFLICT", "TOOLCHAIN_UNAVAILABLE", "DEPENDENCY_MISSING", "ENVIRONMENT_OFFLINE", "RUNNER_UNAVAILABLE", "RUNNER_TIMEOUT", "RUNNER_DISCONNECTED", "RUNNER_IDENTITY_UNVERIFIED", "ADAPTER_UNAVAILABLE", "ADAPTER_ERROR", "PLATFORM_MISMATCH", "TOOLCHAIN_MISSING", "TOOLCHAIN_VERSION_MISMATCH", "MODULE_MISSING", "GPU_UNAVAILABLE", "RESOURCE_UNAVAILABLE", "CONTAINER_POLICY_DENIED", "SIGNING_NOT_AUTHORIZED", "PUBLISHING_NOT_AUTHORIZED", "SOURCE_MISMATCH", "INTEGRITY_FAILED", "VERIFICATION_REQUIRED", "REVERIFICATION_REQUIRED", "REVIEW_REQUIRED", "REVIEW_NOT_INDEPENDENT", "STAGING_CONFLICT", "COMMIT_FAILED", "BRANCH_PROTECTED", "REMOTE_CHANGED", "PUSH_FAILED", "TARGET_NOT_REGISTERED", "STALE_CANDIDATE", "DEPLOYMENT_LOCKED", "DEPLOYMENT_FAILED", "ROLLBACK_UNAVAILABLE", "ROLLBACK_FAILED"];
export type ExecutionErrorCode = (typeof EXECUTION_ERROR_CODES)[number];
export interface ExecutionReason {
    code: ExecutionErrorCode;
    /** Short, safe, operator-facing detail. Never a secret or a stack trace. */
    detail: string;
}
export interface ExecutionResourceLimits {
    /** Whole-session wall clock. Required: no execution is unbounded. */
    sessionTimeoutMs: number;
    /** Per-operation wall clock. Required and ≤ sessionTimeoutMs. */
    operationTimeoutMs: number;
    maxOutputBytes: number;
    maxArtifactBytes: number;
    maxToolCalls: number;
    /** Optional: only meaningful when a sandbox provider can enforce them. */
    cpuMillicores?: number;
    memoryBytes?: number;
    maxProcesses?: number;
    filesystemQuotaBytes?: number;
    maxModelCalls?: number;
}
export declare const REQUIRED_LIMIT_KEYS: readonly ["sessionTimeoutMs", "operationTimeoutMs", "maxOutputBytes", "maxArtifactBytes", "maxToolCalls"];
export declare const OPTIONAL_LIMIT_KEYS: readonly ["cpuMillicores", "memoryBytes", "maxProcesses", "filesystemQuotaBytes", "maxModelCalls"];
export type ResourceLimitKey = (typeof REQUIRED_LIMIT_KEYS)[number] | (typeof OPTIONAL_LIMIT_KEYS)[number];
/** Absolute ceilings no policy may exceed (bounded by construction). */
export declare const LIMIT_CEILINGS: Readonly<Record<ResourceLimitKey, number>>;
export declare function validateResourceLimits(value: unknown, field?: string): ExecutionResourceLimits;
/** The stricter of two limit sets (a rule can only tighten a policy). */
export declare function tightenLimits(base: ExecutionResourceLimits, override: Partial<ExecutionResourceLimits> | undefined): ExecutionResourceLimits;
export type LimitEnforcement = "enforced" | "unsupported";
/** Per-limit statement of whether the chosen sandbox can enforce it. */
export type LimitEnforcementReport = Partial<Record<ResourceLimitKey, LimitEnforcement>>;
export interface NetworkDestination {
    /** Exact lowercase DNS host name (no wildcard, no IP literal). */
    host: string;
    port: number;
    scheme: "https";
}
export type NetworkPolicy = {
    mode: "deny_all";
} | {
    mode: "allow_approved_hosts";
    destinations: readonly NetworkDestination[];
};
export declare const DENY_ALL_NETWORK: NetworkPolicy;
/**
 * A destination is only acceptable when it is an exact, public-looking DNS
 * name over HTTPS. IP literals (incl. loopback, private, link-local and the
 * 169.254.169.254 metadata address), `localhost`, internal suffixes and cloud
 * metadata names are rejected here. DNS-rebinding / resolved-address checks
 * are the enforcing provider's job and are NOT claimed by this contract.
 */
export declare function validateNetworkDestination(value: unknown, field?: string): NetworkDestination;
export declare function validateNetworkPolicy(value: unknown, field?: string): NetworkPolicy;
/** `secret://<name>` — a name only. There is no value field anywhere. */
export type SecretReference = `secret://${string}`;
export declare function validateSecretReference(value: unknown, field?: string): SecretReference;
/** Metadata about a secret reference. Never the value. */
export interface SecretDescriptor {
    ref: SecretReference;
    available: boolean;
}
/**
 * Opaque, single-use handle a sandbox provider exchanges for a value at the
 * last possible moment. Models, agents, logs and receipts only ever see this.
 */
export interface SecretHandle {
    handleId: string;
    ref: SecretReference;
    grantId: string;
    expiresAt: string;
}
/**
 * SecretBroker port. The execution system asks for a HANDLE bound to a
 * capability grant; it never receives or serializes a raw secret.
 */
export interface SecretBroker {
    describe(ref: SecretReference): Promise<SecretDescriptor>;
    issueHandle(ref: SecretReference, grant: CapabilityGrant): Promise<SecretHandle>;
}
export declare const EXECUTION_STAGE_KINDS: readonly ["build", "test", "security", "deployment"];
export type ExecutionStageKind = (typeof EXECUTION_STAGE_KINDS)[number];
/** Per-field schema of an operation's structured input. */
export type OperationInputField = {
    kind: "enum";
    values: readonly string[];
    required?: boolean;
} | {
    kind: "integer";
    min: number;
    max: number;
    required?: boolean;
}
/** A path RELATIVE to the session workspace; validated, never absolute. */
 | {
    kind: "workspace_path";
    required?: boolean;
}
/** EO-4.3: bounded UTF-8 text (file content, search query). */
 | {
    kind: "text";
    maxBytes: number;
    required?: boolean;
}
/** EO-4.3: a lowercase hex SHA-256 (expected content hash). */
 | {
    kind: "sha256";
    required?: boolean;
};
/**
 * A registered, server-side execution operation. The agent-facing boundary is
 * `{ operationId, input }` — never a command string. Risk and capabilities are
 * declared here and cannot be supplied or lowered by a request.
 */
export interface ExecutionOperationDefinition {
    id: string;
    /** Must be registered in the existing ToolRegistry (the tool boundary). */
    toolId: string;
    stageKind: ExecutionStageKind;
    description: string;
    requiredCapabilities: readonly ExecutionCapability[];
    /**
     * EO-4.3: capabilities the operation can USE when the policy rule grants
     * them (e.g. `filesystem.write.protected`). Never requested by a caller.
     */
    optionalCapabilities?: readonly ExecutionCapability[];
    risk: ExecutionRiskLevel;
    input: Readonly<Record<string, OperationInputField>>;
    /** Output schema; output failing it is `INVALID_OUTPUT`. Default: text. */
    output?: OperationOutputSpec;
    /** Toolchain kinds the environment instance must have (e.g. `node`). */
    requiredToolchains?: readonly string[];
    /** Filesystem reach. Default derived from capabilities (none/read/write). */
    workspaceAccess?: "none" | "read" | "write";
    /** Network reach. Default `none`; a tool cannot widen session policy. */
    networkAccess?: "none" | "approved_hosts";
    /** Per-operation timeout (ms); the effective timeout is the minimum. */
    timeoutMs?: number;
    /**
     * EO-4.4: `project_code` = the operation executes the project's own code
     * (builds, tests). It can only run on a provider that isolates the
     * workspace, or on a host build runner when the policy rule explicitly
     * opts in with `trustedHostBuild`.
     */
    executionClass?: "diagnostic" | "project_code" | "adapter";
    /**
     * EO-4.5: what the operation needs from an execution environment. When
     * present, an EnvironmentExecutionAdapter + runner must be ready for the
     * selected instance (resolved from authoritative metadata only).
     */
    environment?: EnvironmentOperationRequirement;
}
/** How operation stdout is validated before anyone sees it. */
export type OperationOutputSpec = {
    kind: "text";
}
/** EO-4.3: a single JSON object (structured workspace/repository result). */
 | {
    kind: "json";
}
/** Exactly one semantic version, e.g. `v20.11.1` / `20.11.1`. */
 | {
    kind: "semver";
};
/** Workspace reach of an operation (explicit, else from its capabilities). */
export declare function operationWorkspaceAccess(op: ExecutionOperationDefinition): "none" | "read" | "write";
/**
 * EO-4.2 execution tool: a trusted, composition-registered bundle of typed
 * operations over ONE server-controlled executable. Identity is `toolId`
 * (never `displayName`). A tool cannot grant itself capabilities: policy
 * authority stays outside the tool.
 */
export interface ExecutionToolDefinition {
    toolId: string;
    version: string;
    displayName: string;
    description: string;
    /** Capabilities any operation of this tool needs (on top of its own). */
    requiredCapabilities: readonly ExecutionCapability[];
    /** Environment capabilities an instance must provide to host this tool. */
    supportedEnvironmentCapabilities: readonly CapabilityId[];
    executable: ExecutableDefinition;
    /** Registered operation ids exposed by this tool. Nothing else. */
    operations: readonly string[];
}
export declare function validateExecutionToolDefinition(def: ExecutionToolDefinition): void;
export declare function validateOperationDefinition(def: ExecutionOperationDefinition): void;
/** One argv slot of a server-controlled executable definition. */
export type ArgumentSlot = {
    kind: "literal";
    value: string;
} | {
    kind: "enum_input";
    input: string;
    values: readonly string[];
} | {
    kind: "integer_input";
    input: string;
    min: number;
    max: number;
} | {
    kind: "workspace_path_input";
    input: string;
};
/**
 * Server-controlled executable. The executable location is resolved by the
 * provider from `executableId` — an agent can never submit a path. Every
 * argument comes from a fixed template; there are no free-form arguments.
 */
export interface ExecutableDefinition {
    executableId: string;
    operations: Readonly<Record<string, readonly ArgumentSlot[]>>;
    /** Names of controlled env vars; values come from config or secret handles. */
    environmentVariables: readonly string[];
    /**
     * EO-4.4: workspace-relative paths an operation needs before it can run
     * (e.g. installed dependencies). Missing → DEPENDENCY_MISSING; nothing is
     * installed automatically.
     */
    requiredPaths?: Readonly<Record<string, readonly string[]>>;
}
/**
 * A structured, bounded invocation for a future sandbox adapter. There is no
 * `rawShellCommand`, and it is never exposed to a model.
 */
export interface StructuredInvocation {
    executableId: string;
    operationId: string;
    argv: readonly string[];
    workingDirectoryRef: string;
    environmentVariableRefs: readonly string[];
    timeoutMs: number;
    /**
     * EO-4.3: the validated structured input, for in-process adapters
     * (workspace file operations). Process adapters use `argv` only.
     */
    input?: Readonly<Record<string, string | number>>;
    /** EO-4.4: dependency paths that must exist in the workspace. */
    requiredPaths?: readonly string[];
}
export interface FilesystemScope {
    access: "read" | "write";
    /** Workspace-relative prefix, `.` = the whole workspace. */
    path: string;
}
export interface ExecutionPolicyRule {
    id: string;
    /** Operation ids this rule permits. Exact match only — no wildcard. */
    operationIds: readonly string[];
    /** Capabilities this rule may grant. Exact match only — no implication. */
    capabilities: readonly ExecutionCapability[];
    filesystem: readonly FilesystemScope[];
    /** Environment capabilities the selected instance must still provide. */
    requiredEnvironmentCapabilities: readonly CapabilityId[];
    network?: NetworkPolicy;
    /** Secret references this rule may request handles for. */
    secretRefs?: readonly SecretReference[];
    /** Can only TIGHTEN the policy defaults. */
    limits?: Partial<ExecutionResourceLimits>;
    /**
     * EO-4.2: permit running on a HOST process provider that does not isolate
     * filesystem or network. Only ever applies to operations that touch no
     * workspace and no network (e.g. a registered version query). Default false.
     */
    hostProcess?: boolean;
    /**
     * EO-4.4: explicit, per-project risk acceptance to run the project's own
     * build/test code on a HOST build runner that does not isolate filesystem
     * or network. Only for trusted repositories. Default false.
     */
    trustedHostBuild?: boolean;
}
/**
 * Versioned, immutable execution policy. `(policyId, version)` identifies
 * exactly one policy forever; a receipt names the version that governed it.
 * DENY UNLESS PERMITTED: an operation is allowed only when a rule lists it and
 * grants every capability it needs, none of which are forbidden.
 */
export interface ExecutionPolicy {
    policyId: string;
    version: number;
    description: string;
    rules: readonly ExecutionPolicyRule[];
    /** Explicit forbids override any rule. */
    forbiddenCapabilities: readonly ExecutionCapability[];
    /** Operations above this risk are denied outright. */
    maxRisk: ExecutionRiskLevel;
    /** Operations at/above this risk need an approved approval for the revision. */
    approvalRequiredAtOrAbove: ExecutionRiskLevel;
    defaultLimits: ExecutionResourceLimits;
    /** Default: deny_all. */
    network: NetworkPolicy;
    /** How long a capability grant stays valid (ms). */
    grantTtlMs: number;
}
export declare function validateExecutionPolicy(policy: ExecutionPolicy): void;
/**
 * One capability, granted to ONE execution context, until `expiresAt`.
 * Never global, never permanent.
 */
export interface CapabilityGrant {
    grantId: string;
    sessionId: string;
    projectId: string;
    agentId: string;
    environmentInstanceId: string;
    workspaceId: string;
    toolId: string;
    operationId: string;
    capability: ExecutionCapability;
    filesystem?: readonly FilesystemScope[];
    network?: NetworkPolicy;
    policyId: string;
    policyVersion: number;
    issuedAt: string;
    expiresAt: string;
}
export interface GrantUseContext {
    sessionId: string;
    projectId: string;
    agentId: string;
    environmentInstanceId: string;
    workspaceId: string;
    toolId: string;
    operationId: string;
    capability: ExecutionCapability;
    /** ISO time of use. */
    at: string;
}
/** A grant applies only to the exact context it was issued for. */
export declare function grantAllows(grant: CapabilityGrant, use: GrantUseContext): boolean;
export declare const WORKSPACE_STATUSES: readonly ["requested", "prepared", "released"];
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];
/**
 * The filesystem boundary for one session. `rootRef` is an opaque reference
 * resolved only by a sandbox provider — never a host path an agent sees.
 */
export interface ExecutionWorkspace {
    workspaceId: string;
    sessionId: string;
    projectId: string;
    rootRef: string;
    mode: "read_only" | "read_write";
    status: WorkspaceStatus;
    quotaBytes?: number;
}
export declare const SANDBOX_KINDS: readonly ["local_restricted_process", "docker", "windows_runner", "macos_runner", "cloud_runner", "game_engine_runner"];
export type SandboxKind = (typeof SANDBOX_KINDS)[number];
/**
 * What a provider can ACTUALLY enforce. A limit not listed in
 * `enforcedLimits` is reported as `unsupported`, never silently claimed.
 */
export interface SandboxProviderCapabilities {
    enforcedLimits: readonly ResourceLimitKey[];
    /** Network policy modes the provider can run under. */
    networkModes: readonly NetworkPolicy["mode"][];
    /** Whether the provider actually ENFORCES the network policy. */
    networkIsolation: boolean;
    filesystemIsolation: boolean;
    supportsKill: boolean;
    /** Max simultaneous invocations this provider accepts. */
    maxConcurrentInvocations: number;
    /**
     * EO-4.3: executable ids this provider can serve. Absent = any. A provider
     * is never selected for an operation whose executable it cannot run.
     */
    executables?: readonly string[];
    /**
     * EO-4.4: the provider runs processes INSIDE the workspace root (build
     * runner). Required for `project_code` operations on a host runner.
     */
    workspaceExecution?: boolean;
    /** Test/simulation provider: receipts are labelled `simulated: true`. */
    simulated?: boolean;
    /**
     * EO-4.5: a runner bridge. Only eligible when the ExecutionManager routed
     * the operation to this exact provider through the adapter registry.
     */
    requiresRouting?: boolean;
}
export interface SandboxSpec {
    sessionId: string;
    projectId: string;
    environmentInstanceId: string;
    workspace: ExecutionWorkspace;
    limits: ExecutionResourceLimits;
    network: NetworkPolicy;
    grants: readonly CapabilityGrant[];
}
export interface SandboxInvokeOptions {
    signal: AbortSignal;
    maxOutputBytes: number;
    /** Values that must never appear in output (e.g. issued secret values). */
    knownSecrets?: readonly string[];
}
/** Sanitized result of one invocation: no pid, env or raw process state. */
export interface SandboxInvocationOutcome {
    exitClass: ExitClassification;
    exitCode: number | null;
    stdout: BoundedOutput;
    stderr: BoundedOutput;
    durationMs: number;
    redactions: number;
    /** EO-4.3: an expected refusal inside the adapter (not a tool failure). */
    denial?: ExecutionReason;
    /** EO-4.3: mutation evidence (hashes/sizes only, never content). */
    changes?: readonly FileChangeEvidence[];
    changeSetId?: string;
    /** EO-4.5: environment/adapter/runner evidence (no secrets). */
    environment?: EnvironmentExecutionEvidence;
}
export interface SandboxHandle {
    sandboxId: string;
    providerId: string;
    sessionId: string;
}
/**
 * Provider-neutral isolation boundary. A sandbox may run WITHIN an
 * EnvironmentInstance but is not one: the environment says where compatible
 * tools exist; the sandbox is the security boundary execution runs in.
 * EO-4.1 defines the contract only — no provider runs anything yet, and
 * `invoke` accepts a StructuredInvocation, never a command string.
 */
export interface SandboxProvider {
    readonly providerId: string;
    readonly kind: SandboxKind;
    readonly capabilities: SandboxProviderCapabilities;
    /** Whether this provider can serve the given environment instance now. */
    isAvailableFor(environmentInstanceId: string): boolean;
    prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace>;
    start(spec: SandboxSpec): Promise<SandboxHandle>;
    /**
     * Run ONE structured invocation: a trusted executable resolved from
     * `executableId`, a validated argv, a controlled environment, a bounded
     * timeout and output. Never a shell. Honors `signal` (cancel/kill) by
     * terminating the process tree where the platform allows it.
     */
    invoke(handle: SandboxHandle, invocation: StructuredInvocation, options: SandboxInvokeOptions): Promise<SandboxInvocationOutcome>;
    terminate(handle: SandboxHandle, reason: string): Promise<void>;
    collectOutputs(handle: SandboxHandle): Promise<readonly ArtifactReference[]>;
    cleanup(handle: SandboxHandle): Promise<void>;
}
export declare const EXECUTION_SESSION_STATUSES: readonly ["created", "validating", "ready", "running", "cancelling", "cancelled", "succeeded", "failed", "timed_out", "denied"];
export type ExecutionSessionStatus = (typeof EXECUTION_SESSION_STATUSES)[number];
export declare const TERMINAL_SESSION_STATUSES: readonly ExecutionSessionStatus[];
/** Strict lifecycle. Terminal states have no exits — retries are new attempts. */
export declare const SESSION_TRANSITIONS: Readonly<Record<ExecutionSessionStatus, readonly ExecutionSessionStatus[]>>;
export declare function isTerminalSession(status: ExecutionSessionStatus): boolean;
export declare function canTransitionSession(from: ExecutionSessionStatus, to: ExecutionSessionStatus): boolean;
export interface ExecutionPlanReference {
    /** Stable plan series id. */
    planId: string;
    /** Exact revision. Execution never floats to "the newest". */
    version: number;
    /** Document id `${planId}@v${version}`. */
    executionPlanId: string;
}
/**
 * One governed execution of one plan stage. Identity is the opaque, stable
 * `sessionId` — never a project, agent or environment display name.
 * No secret values: only references and grants.
 */
export interface ExecutionSession {
    sessionId: string;
    projectId: string;
    plan: ExecutionPlanReference;
    stageId: string;
    stageKind: ExecutionStageKind;
    operationId: string;
    toolId: string;
    /**
     * EO-4.3: every operation this session may invoke (primary first). A
     * multi-operation session is PERSISTENT: invocations do not end it; it ends
     * with an explicit completion, cancellation or its time budget.
     */
    operationIds?: readonly string[];
    persistent?: boolean;
    workflowId?: string;
    taskId?: string;
    agentId: string;
    environmentInstanceId: string;
    policy: {
        policyId: string;
        version: number;
    };
    approvalIds: readonly string[];
    risk: ExecutionRiskLevel;
    workspace: ExecutionWorkspace;
    grants: readonly CapabilityGrant[];
    limits: ExecutionResourceLimits;
    limitEnforcement: LimitEnforcementReport;
    network: NetworkPolicy;
    sandbox?: {
        providerId: string;
        kind: SandboxKind;
    };
    status: ExecutionSessionStatus;
    reasons: readonly ExecutionReason[];
    requestedBy: string;
    idempotencyKey: string;
    cancellation?: {
        requestedBy: string;
        requestedAt: string;
        reason: string;
        kind: "cancel" | "kill";
    };
    attempts: readonly ExecutionAttempt[];
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
    revision: number;
}
export declare const ATTEMPT_STATUSES: readonly ["pending", "running", "succeeded", "failed", "timed_out", "cancelled"];
export type ExecutionAttemptStatus = (typeof ATTEMPT_STATUSES)[number];
/** A retry is a NEW attempt; earlier attempts stay as evidence. */
export interface ExecutionAttempt {
    attemptId: string;
    sessionId: string;
    number: number;
    status: ExecutionAttemptStatus;
    startedAt?: string;
    endedAt?: string;
    receiptId?: string;
}
export interface BoundedOutput {
    text: string;
    /** Explicit: callers always know when output was cut. */
    truncated: boolean;
    originalBytes: number;
}
export type LogSeverity = "debug" | "info" | "warning" | "error";
export interface ExecutionLogEntry {
    sessionId: string;
    attemptId?: string;
    toolId?: string;
    timestamp: string;
    severity: LogSeverity;
    /** Redacted and bounded. */
    message: string;
    truncated: boolean;
}
export interface ArtifactReference {
    artifactId: string;
    kind: string;
    sizeBytes: number;
    digest: {
        algorithm: "sha256";
        value: string;
    };
    mediaType: string;
    producerSessionId: string;
    /** Opaque storage reference; artifacts are never inlined. */
    storageRef: string;
}
export declare const EXIT_CLASSIFICATIONS: readonly ["success", "tool_failure", "timeout", "cancelled", "resource_limit", "sandbox_failure", "denied"];
export type ExitClassification = (typeof EXIT_CLASSIFICATIONS)[number];
/**
 * Immutable evidence of ONE execution attempt (≠ audit event, which records
 * governance/security history). `simulated: true` marks receipts produced by
 * tests/simulation — never to be presented as production execution.
 */
export interface ExecutionReceipt {
    receiptId: string;
    sessionId: string;
    attemptId: string;
    projectId: string;
    plan: ExecutionPlanReference;
    stageId: string;
    agentId: string;
    environmentInstanceId: string;
    toolId: string;
    operationId: string;
    policy: {
        policyId: string;
        version: number;
    };
    approvalIds: readonly string[];
    startedAt: string;
    endedAt: string;
    outcome: "succeeded" | "failed" | "timed_out" | "cancelled" | "denied";
    exitClass: ExitClassification;
    artifacts: readonly ArtifactReference[];
    logRefs: readonly string[];
    resources: {
        wallClockMs: number;
        outputBytes: number;
        outputTruncated: boolean;
    };
    redaction: {
        applied: true;
        redactedValues: number;
    };
    simulated: boolean;
    /** EO-4.2: the idempotency key of the invocation this receipt records. */
    invocationId?: string;
    /** EO-4.2: denial / failure reasons (codes + safe details). */
    reasons?: readonly ExecutionReason[];
    /** EO-4.3: file mutation evidence (no content). */
    changes?: readonly FileChangeEvidence[];
    changeSetId?: string;
    workspaceId?: string;
    /** EO-4.5: environment/adapter/runner evidence (no secrets). */
    environment?: EnvironmentExecutionEvidence;
}
/**
 * What a client may ask for. References only — project, plan revision, stage
 * and (optionally) a registered operation with structured input. No command
 * text, no executable, no risk, no capability, no approval state.
 */
export interface ExecutionRequest {
    projectId: string;
    planId: string;
    planVersion: number;
    stageId: string;
    operationId?: string;
    /** EO-4.3: further registered operations for a persistent session. */
    operationIds?: readonly string[];
    input?: Record<string, string | number>;
}
export declare const EXECUTION_REQUEST_KEYS: readonly ["projectId", "planId", "planVersion", "stageId", "operationId", "operationIds", "input"];
export declare function validateExecutionRequest(value: unknown): ExecutionRequest;
export declare const PREFLIGHT_CHECKS: readonly ["authorization", "plan", "stage", "approval", "policy", "agent", "environment", "tool", "input", "workspace", "sandbox"];
export type PreflightCheck = (typeof PREFLIGHT_CHECKS)[number];
export interface PreflightResult {
    decision: "ELIGIBLE" | "DENIED";
    /** Every failing gate, in check order. Empty iff ELIGIBLE. */
    reasons: readonly ExecutionReason[];
    checks: Readonly<Record<PreflightCheck, "pass" | "fail" | "skipped">>;
    plan: ExecutionPlanReference;
    projectId: string;
    stageId: string;
    stageKind?: ExecutionStageKind;
    operationId?: string;
    toolId?: string;
    agentId?: string;
    environmentInstanceId?: string;
    policy?: {
        policyId: string;
        version: number;
    };
    risk?: ExecutionRiskLevel;
    requiredCapabilities: readonly ExecutionCapability[];
    requiredApprovals: readonly {
        reason: string;
        approvalId?: string;
        state: string;
    }[];
    limits?: ExecutionResourceLimits;
    limitEnforcement?: LimitEnforcementReport;
    network?: NetworkPolicy;
    sandbox?: {
        providerId: string;
        kind: SandboxKind;
    };
    /** What the selected sandbox actually isolates (never claimed otherwise). */
    isolation?: {
        filesystem: boolean;
        network: boolean;
    };
    /** Operators cannot execute from the UI; invocation is orchestrator-only. */
    executionAvailable: false;
}
/**
 * The ONLY invocation shape: a registered tool + operation with structured
 * input, bound to a governed session and an idempotency key. There is no
 * command, executable, working directory, environment or network field;
 * unknown properties are rejected.
 */
export interface InvocationRequest {
    sessionId: string;
    invocationId: string;
    toolId: string;
    operationId: string;
    input?: Record<string, string | number>;
}
export declare const INVOCATION_REQUEST_KEYS: readonly ["sessionId", "invocationId", "toolId", "operationId", "input"];
export declare function validateInvocationRequest(value: unknown): InvocationRequest;
/** What the orchestrator/agent gets back. Sanitized; no raw process state. */
export interface InvocationResult {
    invocationId: string;
    sessionId: string;
    outcome: ExecutionReceipt["outcome"];
    exitClass: ExitClassification;
    reasons: readonly ExecutionReason[];
    output?: {
        text: string;
        truncated: boolean;
    };
    /** Structured result from the operation output schema. */
    result?: Record<string, unknown>;
    /** EO-4.3: file mutation evidence and the session ChangeSet. */
    changes?: readonly FileChangeEvidence[];
    changeSetId?: string;
    /** EO-4.5: environment/adapter/runner evidence (no secrets). */
    environment?: EnvironmentExecutionEvidence;
    receiptId: string;
    /** True when this is a replay of an earlier identical invocation. */
    replayed: boolean;
}
