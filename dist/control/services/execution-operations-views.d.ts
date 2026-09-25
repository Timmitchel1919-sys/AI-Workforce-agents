/**
 * EO-4.7 Execution Control Center read models — authoritative only.
 *
 * Everything here is derived from recorded backend state (sessions,
 * receipts, audit, verifications, source-control and release receipts,
 * the environment adapter registry). Nothing is estimated or synthesized:
 * an absent subsystem is reported as `configured: false`, an absent event
 * is simply not in the timeline. Every read is project-scoped by the
 * underlying services (another project's data is 404) and bounded.
 */
import { type ExecutionSession, type ExecutionSessionStatus, type OperatorPrincipal, type ReleaseReceipt, type VerificationResult } from "../../contracts/index.js";
import type { ControlPlaneContext } from "../context.js";
export interface ExecutionSessionSummaryView {
    sessionId: string;
    projectId: string;
    plan: ExecutionSession["plan"];
    stageId: string;
    stageKind: ExecutionSession["stageKind"];
    operationId: string;
    status: ExecutionSessionStatus;
    agentId: string;
    environmentInstanceId: string;
    runner?: {
        providerId: string;
        kind: string;
    };
    workspaceId: string;
    approvalIds: readonly string[];
    reasonCodes: readonly string[];
    attempts: number;
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
}
export declare function listExecutionSessions(ctx: ControlPlaneContext, principal: OperatorPrincipal, projectId: string, query?: {
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<{
    items: ExecutionSessionSummaryView[];
    total: number;
    limit: number;
    offset: number;
} | undefined>;
export declare function getExecutionOverview(ctx: ControlPlaneContext, principal: OperatorPrincipal, projectId: string): Promise<{
    projectId: string;
    sessions: {
        total: number;
        byStatus: Partial<Record<"denied" | "failed" | "created" | "running" | "cancelled" | "ready" | "timed_out" | "validating" | "cancelling" | "succeeded", number>>;
        awaitingApproval: number;
    };
    verifications: {
        configured: boolean;
        total: number;
        byStatus: Record<string, number>;
    } | {
        configured: boolean;
        total?: undefined;
        byStatus?: undefined;
    };
    releases: {
        configured: boolean;
        total: number;
        byStatus: Record<string, number>;
    } | {
        configured: boolean;
        total?: undefined;
        byStatus?: undefined;
    };
} | undefined>;
export declare function getExecutionSessionDetail(ctx: ControlPlaneContext, principal: OperatorPrincipal, projectId: string, sessionId: string, query?: {
    timelineLimit?: number;
    timelineOffset?: number;
}): Promise<{
    session: {
        cancellation?: {
            kind: "cancel" | "kill";
            requestedAt: string;
            requestedBy: string;
        } | undefined;
        reasons: {
            code: "CONTAINER_POLICY_DENIED" | "POLICY_DENIED" | "AUTHORIZATION_DENIED" | "APPROVAL_REQUIRED" | "STALE_PLAN" | "PLAN_NOT_EXECUTABLE" | "AGENT_NOT_QUALIFIED" | "ENVIRONMENT_UNAVAILABLE" | "WORKSPACE_VIOLATION" | "TOOL_NOT_ALLOWED" | "INVALID_TOOL_INPUT" | "SANDBOX_UNAVAILABLE" | "RESOURCE_LIMIT" | "TIMEOUT" | "CANCELLED" | "SANDBOX_FAILURE" | "INTERNAL_ERROR" | "CAPABILITY_NOT_GRANTED" | "INVALID_OUTPUT" | "WORKSPACE_CONFLICT" | "TOOLCHAIN_UNAVAILABLE" | "DEPENDENCY_MISSING" | "ENVIRONMENT_OFFLINE" | "RUNNER_UNAVAILABLE" | "RUNNER_TIMEOUT" | "RUNNER_DISCONNECTED" | "RUNNER_IDENTITY_UNVERIFIED" | "ADAPTER_UNAVAILABLE" | "ADAPTER_ERROR" | "PLATFORM_MISMATCH" | "TOOLCHAIN_MISSING" | "TOOLCHAIN_VERSION_MISMATCH" | "MODULE_MISSING" | "GPU_UNAVAILABLE" | "RESOURCE_UNAVAILABLE" | "SIGNING_NOT_AUTHORIZED" | "PUBLISHING_NOT_AUTHORIZED" | "SOURCE_MISMATCH" | "INTEGRITY_FAILED" | "VERIFICATION_REQUIRED" | "REVERIFICATION_REQUIRED" | "REVIEW_REQUIRED" | "REVIEW_NOT_INDEPENDENT" | "STAGING_CONFLICT" | "COMMIT_FAILED" | "BRANCH_PROTECTED" | "REMOTE_CHANGED" | "PUSH_FAILED" | "TARGET_NOT_REGISTERED" | "STALE_CANDIDATE" | "DEPLOYMENT_LOCKED" | "DEPLOYMENT_FAILED" | "ROLLBACK_UNAVAILABLE";
            detail: string;
        }[];
        limits: import("../../contracts/execution.js").ExecutionResourceLimits;
        network: import("../../contracts/execution.js").NetworkPolicy;
        policy: {
            policyId: string;
            version: number;
        };
        risk: "low" | "high" | "critical" | "medium";
        grants: {
            capability: "filesystem.read" | "filesystem.write.workspace" | "filesystem.delete.workspace" | "filesystem.write.protected" | "repository.read" | "repository.write" | "repository.commit" | "repository.push" | "repository.branch.manage" | "process.invoke.bounded" | "network.outbound.allowed-host" | "artifact.write" | "test.invoke" | "build.invoke" | "security.scan.invoke" | "deploy.invoke" | "secret.reference.use";
            expiresAt: string;
        }[];
        workspace: {
            workspaceId: string;
            mode: "read_only" | "read_write";
            status: "requested" | "prepared" | "released";
        };
        sessionId: string;
        projectId: string;
        plan: ExecutionSession["plan"];
        stageId: string;
        stageKind: ExecutionSession["stageKind"];
        operationId: string;
        status: ExecutionSessionStatus;
        agentId: string;
        environmentInstanceId: string;
        runner?: {
            providerId: string;
            kind: string;
        };
        workspaceId: string;
        approvalIds: readonly string[];
        reasonCodes: readonly string[];
        attempts: number;
        createdAt: string;
        startedAt?: string;
        endedAt?: string;
    };
    agent: {
        agentId: string;
        name: string;
        capabilities: readonly string[];
        enabled: boolean;
        registered?: undefined;
    } | {
        agentId: string;
        registered: boolean;
        name?: undefined;
        capabilities?: undefined;
        enabled?: undefined;
    };
    model: {
        model?: string | undefined;
        provider: string | undefined;
    } | undefined;
    environment: {
        environmentInstanceId: string;
        name: string;
        environmentType: "cloud_runner" | "container_host" | "unity" | "visual_studio_code" | "visual_studio" | "xcode" | "android_studio" | "docker" | "unreal_engine" | "cli" | "web_build" | "desktop_build" | "mobile_build" | "game_build";
        availability: "available" | "unavailable" | "degraded" | "disabled";
        toolchains: {
            version?: string | undefined;
            kind: "node" | "dotnet" | "swift_xcode" | "jdk_gradle" | "android_sdk" | "cpp_compiler" | "unity" | "unreal" | "python" | "rust" | "go" | "dart";
        }[];
        registered?: undefined;
    } | {
        environmentInstanceId: string;
        registered: boolean;
        name?: undefined;
        environmentType?: undefined;
        availability?: undefined;
        toolchains?: undefined;
    };
    changeSet: {
        baselineCount: number;
        entries: {
            risk: "normal" | "protected";
            sizeDelta: number;
            fromPath?: string | undefined;
            path: string;
            change: import("../../contracts/workspace.js").FileChangeKind;
        }[];
        updatedAt: string;
        baseRevision?: string | undefined;
        changeSetId: string;
        status: "verified" | "open" | "ready_for_review" | "rolled_back" | "abandoned" | "verifying" | "verification_failed";
    } | undefined;
    verifications: VerificationResult[];
    receipts: {
        environment?: import("../../contracts/environment-adapters.js").EnvironmentExecutionEvidence | undefined;
        changes?: {
            fromPath?: string | undefined;
            path: string;
            change: import("../../contracts/workspace.js").FileChangeKind;
        }[] | undefined;
        changeSetId?: string | undefined;
        receiptId: string;
        attemptId: string;
        operationId: string;
        toolId: string;
        outcome: "denied" | "failed" | "cancelled" | "timed_out" | "succeeded";
        exitClass: "success" | "timeout" | "denied" | "tool_failure" | "cancelled" | "resource_limit" | "sandbox_failure";
        startedAt: string;
        endedAt: string;
        reasons: {
            code: "CONTAINER_POLICY_DENIED" | "POLICY_DENIED" | "AUTHORIZATION_DENIED" | "APPROVAL_REQUIRED" | "STALE_PLAN" | "PLAN_NOT_EXECUTABLE" | "AGENT_NOT_QUALIFIED" | "ENVIRONMENT_UNAVAILABLE" | "WORKSPACE_VIOLATION" | "TOOL_NOT_ALLOWED" | "INVALID_TOOL_INPUT" | "SANDBOX_UNAVAILABLE" | "RESOURCE_LIMIT" | "TIMEOUT" | "CANCELLED" | "SANDBOX_FAILURE" | "INTERNAL_ERROR" | "CAPABILITY_NOT_GRANTED" | "INVALID_OUTPUT" | "WORKSPACE_CONFLICT" | "TOOLCHAIN_UNAVAILABLE" | "DEPENDENCY_MISSING" | "ENVIRONMENT_OFFLINE" | "RUNNER_UNAVAILABLE" | "RUNNER_TIMEOUT" | "RUNNER_DISCONNECTED" | "RUNNER_IDENTITY_UNVERIFIED" | "ADAPTER_UNAVAILABLE" | "ADAPTER_ERROR" | "PLATFORM_MISMATCH" | "TOOLCHAIN_MISSING" | "TOOLCHAIN_VERSION_MISMATCH" | "MODULE_MISSING" | "GPU_UNAVAILABLE" | "RESOURCE_UNAVAILABLE" | "SIGNING_NOT_AUTHORIZED" | "PUBLISHING_NOT_AUTHORIZED" | "SOURCE_MISMATCH" | "INTEGRITY_FAILED" | "VERIFICATION_REQUIRED" | "REVERIFICATION_REQUIRED" | "REVIEW_REQUIRED" | "REVIEW_NOT_INDEPENDENT" | "STAGING_CONFLICT" | "COMMIT_FAILED" | "BRANCH_PROTECTED" | "REMOTE_CHANGED" | "PUSH_FAILED" | "TARGET_NOT_REGISTERED" | "STALE_CANDIDATE" | "DEPLOYMENT_LOCKED" | "DEPLOYMENT_FAILED" | "ROLLBACK_UNAVAILABLE";
            detail: string;
        }[];
        resources: {
            wallClockMs: number;
            outputBytes: number;
            outputTruncated: boolean;
        };
        simulated: boolean;
    }[];
    timeline: {
        items: {
            data: Record<string, unknown>;
            actor?: string | undefined;
            id: string;
            timestamp: string;
            action: string;
        }[];
        total: number;
        limit: number;
        offset: number;
    };
} | undefined>;
export declare function getProjectVerifications(ctx: ControlPlaneContext, principal: OperatorPrincipal, projectId: string): Promise<{
    configured: false;
    items: never[];
    currentSourceFingerprint?: undefined;
} | {
    configured: true;
    currentSourceFingerprint: string | undefined;
    items: {
        sourceCurrent: boolean | undefined;
        verificationId: string;
        projectId: string;
        plan: import("../../contracts/execution.js").ExecutionPlanReference;
        sourceSessionId?: string;
        changeSetId?: string;
        sourceFingerprint: string;
        finalFingerprint?: string;
        baseRevision?: string;
        environmentInstanceId?: string;
        toolchains: readonly import("../../contracts/verification.js").ToolchainObservation[];
        isolation: {
            filesystem: boolean;
            network: boolean;
        } | "none_ran";
        stages: readonly import("../../contracts/verification.js").StageRun[];
        artifactIds: readonly string[];
        status: import("../../contracts/verification.js").VerificationStatus;
        reasons: readonly {
            code: string;
            detail: string;
        }[];
        unverifiedStageIds: readonly string[];
        requestedBy: string;
        createdAt: string;
        completedAt?: string;
    }[];
}>;
export declare function getProjectReleases(ctx: ControlPlaneContext, principal: OperatorPrincipal, projectId: string): Promise<{
    sourceControl: {
        reviews: import("../../contracts/release.js").ReviewRecord[];
        stageSets: import("../../contracts/release.js").StageSet[];
        commits: import("../../contracts/release.js").CommitReceipt[];
        pushes: import("../../contracts/release.js").PushReceipt[];
        pullRequests: import("../../contracts/release.js").PullRequestRecord[];
        configured: true;
    } | {
        configured: false;
    };
    deployments: {
        configured: true;
        releases: ReleaseReceipt[];
        targets: {
            targetId: string;
            projectId: string;
            targetClass: import("../../contracts/release.js").DeploymentTargetClass;
            adapterId: string;
            resources: readonly string[];
            providerRef: string;
            timeoutMs: number;
        }[];
    } | {
        configured: false;
        releases?: undefined;
        targets?: undefined;
    };
}>;
