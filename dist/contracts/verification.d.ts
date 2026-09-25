import type { EnvironmentExecutionEvidence } from "./environment-adapters.js";
import type { ExecutionPlanReference, ExecutionStageKind, ExitClassification } from "./execution.js";
export declare const STAGE_RUN_STATUSES: readonly ["not_run", "running", "passed", "failed", "blocked", "timed_out", "cancelled", "error"];
export type StageRunStatus = (typeof STAGE_RUN_STATUSES)[number];
/** Why a stage did not pass — kept distinct, never collapsed into "failed". */
export declare const STAGE_FAILURE_KINDS: readonly ["BUILD_FAILED", "TEST_FAILED", "FINDINGS", "EXECUTION_ERROR", "ENVIRONMENT_UNAVAILABLE", "TOOLCHAIN_UNAVAILABLE", "DEPENDENCY_MISSING", "POLICY_DENIED", "SANDBOX_UNAVAILABLE", "TIMEOUT", "CANCELLED", "BLOCKED_BY_DEPENDENCY", "FAIL_FAST", "NO_PROFILE", "SOURCE_CHANGED"];
export type StageFailureKind = (typeof STAGE_FAILURE_KINDS)[number];
export interface ToolchainObservation {
    kind: string;
    name: string;
    version?: string;
    /** Where the version was observed (never fabricated). */
    source: "environment_registry" | "operation_output";
}
export interface SecurityFindingSummary {
    rule: string;
    severity: "low" | "medium" | "high" | "critical";
    count: number;
}
/** What ONE plan stage actually did in ONE verification. */
export interface StageRun {
    stageRunId: string;
    stageId: string;
    stageKind: ExecutionStageKind;
    /** Test type / security check from the plan, when applicable. */
    category?: string;
    operationId?: string;
    required: boolean;
    status: StageRunStatus;
    failure?: {
        kind: StageFailureKind;
        detail: string;
    };
    attempts: number;
    sessionIds: readonly string[];
    receiptIds: readonly string[];
    exitClass?: ExitClassification;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    /** Bounded, redacted excerpt; `truncated` is explicit. */
    log?: {
        text: string;
        truncated: boolean;
    };
    artifactIds: readonly string[];
    findings?: readonly SecurityFindingSummary[];
    /** EO-4.5: where the stage actually ran (instance/adapter/runner). */
    environment?: EnvironmentExecutionEvidence;
}
export declare const VERIFICATION_STATUSES: readonly ["pending", "running", "passed", "failed", "blocked", "cancelled", "timed_out"];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export declare const TERMINAL_VERIFICATION_STATUSES: readonly VerificationStatus[];
/**
 * Immutable once terminal: a new source state needs a NEW verification. A
 * PASSED verification is evidence for exactly `sourceFingerprint` — it is
 * not a commit, a push or a deployment.
 */
export interface VerificationResult {
    verificationId: string;
    projectId: string;
    plan: ExecutionPlanReference;
    /** The developer session whose ChangeSet is being verified, if any. */
    sourceSessionId?: string;
    changeSetId?: string;
    sourceFingerprint: string;
    /** Fingerprint re-taken after the stages ran (must match). */
    finalFingerprint?: string;
    baseRevision?: string;
    environmentInstanceId?: string;
    toolchains: readonly ToolchainObservation[];
    /** What the runner actually isolated (host builds: not isolated). */
    isolation: {
        filesystem: boolean;
        network: boolean;
    } | "none_ran";
    stages: readonly StageRun[];
    artifactIds: readonly string[];
    status: VerificationStatus;
    reasons: readonly {
        code: string;
        detail: string;
    }[];
    /** Planned stages the profile does not cover (reported, never faked). */
    unverifiedStageIds: readonly string[];
    requestedBy: string;
    createdAt: string;
    completedAt?: string;
}
export interface StageProfile {
    /** Registered operation that executes this plan stage. */
    operationId: string;
    /** Structured input (validated by the operation schema). */
    input?: Readonly<Record<string, string | number>>;
    required: boolean;
    /** Extra ordering constraints (plan dependencies are added automatically). */
    dependsOn?: readonly string[];
    /** Attempts for TRANSIENT execution failures only (1-3). */
    maxAttempts?: number;
    /** Workspace-relative outputs to record as artifacts after success. */
    artifacts?: readonly {
        kind: string;
        path: string;
        mediaType?: string;
    }[];
}
/**
 * Configured by trusted composition per project — never by an agent. Maps
 * plan stage ids to registered operations. Unmapped stages are reported as
 * `not_run` / NO_PROFILE and listed in `unverifiedStageIds`.
 */
export interface VerificationProfile {
    projectId: string;
    stages: Readonly<Record<string, StageProfile>>;
    /** Stop starting new stages after a required failure. */
    failFast: boolean;
    /** Bounded stage parallelism (1-4). */
    maxParallel: number;
    /** When true, unmapped planned stages BLOCK a pass. */
    requireAllPlannedStages: boolean;
}
export declare function validateVerificationProfile(profile: VerificationProfile): void;
/**
 * Metadata for a build/test output that stays inside the authorized
 * workspace. A build artifact is NOT a deployed artifact.
 */
export interface ArtifactRecord {
    artifactId: string;
    projectId: string;
    verificationId: string;
    stageId: string;
    changeSetId?: string;
    sourceFingerprint: string;
    kind: string;
    /** Workspace-relative path (never a host path). */
    path: string;
    mediaType: string;
    sizeBytes: number;
    digest: {
        algorithm: "sha256";
        value: string;
    };
    createdAt: string;
}
export interface ArtifactIntegrity {
    artifactId: string;
    intact: boolean;
    detail: string;
}
/** Deterministic fingerprint of a workspace's source state. */
export interface SourceFingerprint {
    fingerprint: string;
    baseRevision?: string;
    /** Number of changed/untracked source files folded into the fingerprint. */
    changedFiles: number;
}
