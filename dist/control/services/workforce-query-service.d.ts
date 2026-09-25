/**
 * WorkforceQueryService — the read side of the Control Plane.
 *
 * Every method takes an authenticated `OperatorPrincipal`, requires the `view`
 * capability, and returns only data for projects the operator may access.
 * Nothing here mutates state. All secret-bearing fields are redacted.
 */
import { type ExecutionOperationDefinition, type ExecutionSession, type PreflightResult, type ApprovalQuery, type ApprovalView, type AuditEventQuery, type AuditEventView, type AgentView, type DashboardSnapshot, type ExecutionPlanQuery, type OperatorAccountView, type TechnologyCatalogEntryView, type ExecutionPlanSummaryView, type ExecutionPlanView, type OperatorPrincipal, type PageResult, type ProjectView, type SystemHealth, type TaskQuery, type TaskView, type ToolView, type WorkflowQuery, type WorkflowView, type WorkforceStatus, type SoftwareFactoryOverview, type SoftwareFactoryProgramDetail } from "../../contracts/index.js";
import type { EnvironmentDescriptor, EnvironmentInstance, HostCapabilitySnapshot, HostInstance } from "../../contracts/index.js";
import { type ControlPlaneContext } from "../context.js";
import { redact } from "../redaction.js";
export declare class WorkforceQueryService {
    private readonly ctx;
    constructor(ctx: ControlPlaneContext);
    getWorkforceStatus(principal: OperatorPrincipal): WorkforceStatus;
    getGraphProjection(principal: OperatorPrincipal, programId: string): import("../../contracts/index.js").GraphProjection | undefined;
    getSoftwareFactoryOverview(principal: OperatorPrincipal): SoftwareFactoryOverview;
    getSoftwareFactoryProgramDetail(principal: OperatorPrincipal, programId: string): SoftwareFactoryProgramDetail;
    /** @deprecated since Phase 7A — use {@link getSystemHealth}. */
    getHealth(principal: OperatorPrincipal): SystemHealth;
    getSystemHealth(principal: OperatorPrincipal): SystemHealth;
    getAgents(principal: OperatorPrincipal): AgentView[];
    getAgent(principal: OperatorPrincipal, agentId: string): AgentView | undefined;
    getTasks(principal: OperatorPrincipal, query?: TaskQuery): PageResult<TaskView>;
    getTask(principal: OperatorPrincipal, taskId: string): TaskView | undefined;
    /**
     * Bounded, project-scoped workflow listing. `query.projectId` is evaluated
     * server-side against `workflow.projectId` — the frontend never joins or
     * filters this list client-side. Results are deterministically ordered
     * (`updatedAt` desc, id desc tie-break) and cursor-paginated.
     */
    getWorkflows(principal: OperatorPrincipal, query?: WorkflowQuery): PageResult<WorkflowView>;
    getWorkflow(principal: OperatorPrincipal, workflowId: string): WorkflowView | undefined;
    getApprovals(principal: OperatorPrincipal, filter?: {
        status?: string;
    }): ApprovalView[];
    /**
     * The approval queue for the Approvals screen: status/project filters and
     * the shared bounded cursor pagination. Project scope is enforced
     * server-side (a foreign project filter simply yields nothing).
     */
    getApprovalPage(principal: OperatorPrincipal, query?: ApprovalQuery): PageResult<ApprovalView>;
    /**
     * Approval views with their project resolved: orchestrator/tool approvals
     * only carry a `taskId`, so the project comes from the linked task — an
     * approval must never escape project isolation because its metadata
     * lacked a `projectId`.
     */
    private approvalViews;
    getProjects(principal: OperatorPrincipal): Promise<ProjectView[]>;
    getProject(principal: OperatorPrincipal, projectId: string): Promise<ProjectView | undefined>;
    /**
     * The Agents connected to one Project, resolved server-side.
     *
     * Membership comes from the authoritative `AgentRegistry`
     * (`agent.allowedProjects` includes the project, or the agent is
     * project-neutral) — the caller never supplies an agent id list to join.
     * Returns `undefined` when the Project does not exist or the operator may
     * not access it, which the HTTP layer maps to 404 (no existence leak).
     *
     * Because membership is derived from live registry entries, a Project
     * reference to an Agent record that no longer exists cannot be returned:
     * stale references are vacuously skipped rather than crashing the
     * endpoint or fabricating an Agent.
     */
    getProjectAgents(principal: OperatorPrincipal, projectId: string): Promise<AgentView[] | undefined>;
    getTools(principal: OperatorPrincipal): ToolView[];
    getTool(principal: OperatorPrincipal, toolId: string): ToolView | undefined;
    getEnvironmentDescriptors(principal: OperatorPrincipal): EnvironmentDescriptor[];
    getEnvironmentDescriptor(principal: OperatorPrincipal, id: string): EnvironmentDescriptor | undefined;
    getEnvironmentInstances(principal: OperatorPrincipal): EnvironmentInstance[];
    getEnvironmentInstance(principal: OperatorPrincipal, id: string): EnvironmentInstance | undefined;
    getHosts(principal: OperatorPrincipal): HostInstance[];
    getHost(principal: OperatorPrincipal, hostId: string): HostInstance | undefined;
    getHostCapabilitySnapshot(principal: OperatorPrincipal, hostId: string): HostCapabilitySnapshot | undefined;
    /**
     * Pre-flight for one plan stage: ELIGIBLE or DENIED with reason codes.
     * Denials are data (200), not errors. `undefined` → execution not configured.
     */
    executionPreflight(principal: OperatorPrincipal, request: unknown): Promise<PreflightResult | undefined>;
    getExecutionOperations(principal: OperatorPrincipal): ExecutionOperationDefinition[];
    getExecutionSession(principal: OperatorPrincipal, sessionId: string): Promise<ExecutionSession | undefined>;
    getExecutionSessions(principal: OperatorPrincipal, projectId: string): Promise<ExecutionSession[] | undefined>;
    getExecutionSessionPage(principal: OperatorPrincipal, projectId: string, query?: {
        status?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        items: import("./execution-operations-views.js").ExecutionSessionSummaryView[];
        total: number;
        limit: number;
        offset: number;
    } | undefined>;
    getExecutionOverview(principal: OperatorPrincipal, projectId: string): Promise<{
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
    getExecutionSessionDetail(principal: OperatorPrincipal, projectId: string, sessionId: string, query?: {
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
                code: "CONTAINER_POLICY_DENIED" | "POLICY_DENIED" | "AUTHORIZATION_DENIED" | "APPROVAL_REQUIRED" | "STALE_PLAN" | "PLAN_NOT_EXECUTABLE" | "AGENT_NOT_QUALIFIED" | "ENVIRONMENT_UNAVAILABLE" | "WORKSPACE_VIOLATION" | "TOOL_NOT_ALLOWED" | "INVALID_TOOL_INPUT" | "SANDBOX_UNAVAILABLE" | "RESOURCE_LIMIT" | "TIMEOUT" | "CANCELLED" | "SANDBOX_FAILURE" | "INTERNAL_ERROR" | "CAPABILITY_NOT_GRANTED" | "INVALID_OUTPUT" | "WORKSPACE_CONFLICT" | "TOOLCHAIN_UNAVAILABLE" | "DEPENDENCY_MISSING" | "ENVIRONMENT_OFFLINE" | "RUNNER_UNAVAILABLE" | "RUNNER_TIMEOUT" | "RUNNER_DISCONNECTED" | "RUNNER_IDENTITY_UNVERIFIED" | "ADAPTER_UNAVAILABLE" | "ADAPTER_ERROR" | "PLATFORM_MISMATCH" | "TOOLCHAIN_MISSING" | "TOOLCHAIN_VERSION_MISMATCH" | "MODULE_MISSING" | "GPU_UNAVAILABLE" | "RESOURCE_UNAVAILABLE" | "SIGNING_NOT_AUTHORIZED" | "PUBLISHING_NOT_AUTHORIZED" | "SOURCE_MISMATCH" | "INTEGRITY_FAILED" | "VERIFICATION_REQUIRED" | "REVERIFICATION_REQUIRED" | "REVIEW_REQUIRED" | "REVIEW_NOT_INDEPENDENT" | "STAGING_CONFLICT" | "COMMIT_FAILED" | "BRANCH_PROTECTED" | "REMOTE_CHANGED" | "PUSH_FAILED" | "TARGET_NOT_REGISTERED" | "STALE_CANDIDATE" | "DEPLOYMENT_LOCKED" | "DEPLOYMENT_FAILED" | "ROLLBACK_UNAVAILABLE" | "ROLLBACK_FAILED";
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
            status: import("../../contracts/execution.js").ExecutionSessionStatus;
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
        verifications: import("../../contracts/verification.js").VerificationResult[];
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
                code: "CONTAINER_POLICY_DENIED" | "POLICY_DENIED" | "AUTHORIZATION_DENIED" | "APPROVAL_REQUIRED" | "STALE_PLAN" | "PLAN_NOT_EXECUTABLE" | "AGENT_NOT_QUALIFIED" | "ENVIRONMENT_UNAVAILABLE" | "WORKSPACE_VIOLATION" | "TOOL_NOT_ALLOWED" | "INVALID_TOOL_INPUT" | "SANDBOX_UNAVAILABLE" | "RESOURCE_LIMIT" | "TIMEOUT" | "CANCELLED" | "SANDBOX_FAILURE" | "INTERNAL_ERROR" | "CAPABILITY_NOT_GRANTED" | "INVALID_OUTPUT" | "WORKSPACE_CONFLICT" | "TOOLCHAIN_UNAVAILABLE" | "DEPENDENCY_MISSING" | "ENVIRONMENT_OFFLINE" | "RUNNER_UNAVAILABLE" | "RUNNER_TIMEOUT" | "RUNNER_DISCONNECTED" | "RUNNER_IDENTITY_UNVERIFIED" | "ADAPTER_UNAVAILABLE" | "ADAPTER_ERROR" | "PLATFORM_MISMATCH" | "TOOLCHAIN_MISSING" | "TOOLCHAIN_VERSION_MISMATCH" | "MODULE_MISSING" | "GPU_UNAVAILABLE" | "RESOURCE_UNAVAILABLE" | "SIGNING_NOT_AUTHORIZED" | "PUBLISHING_NOT_AUTHORIZED" | "SOURCE_MISMATCH" | "INTEGRITY_FAILED" | "VERIFICATION_REQUIRED" | "REVERIFICATION_REQUIRED" | "REVIEW_REQUIRED" | "REVIEW_NOT_INDEPENDENT" | "STAGING_CONFLICT" | "COMMIT_FAILED" | "BRANCH_PROTECTED" | "REMOTE_CHANGED" | "PUSH_FAILED" | "TARGET_NOT_REGISTERED" | "STALE_CANDIDATE" | "DEPLOYMENT_LOCKED" | "DEPLOYMENT_FAILED" | "ROLLBACK_UNAVAILABLE" | "ROLLBACK_FAILED";
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
    getProjectVerifications(principal: OperatorPrincipal, projectId: string): Promise<{
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
    } | undefined>;
    getProjectReleases(principal: OperatorPrincipal, projectId: string): Promise<{
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
            releases: import("../../contracts/release.js").ReleaseReceipt[];
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
    } | undefined>;
    /** EO-4.5 environment execution status (real runners only count). */
    getExecutionEnvironments(principal: OperatorPrincipal): {
        configured: boolean;
        families: import("../../core/index.js").FamilyExecutionStatus[];
    };
    /**
     * Plan versions of one project, newest first, cursor-paginated with the
     * shared page-size bounds. `undefined` when the project does not exist or
     * the operator may not access it (→ 404, no existence leak).
     */
    getExecutionPlans(principal: OperatorPrincipal, projectId: string, query?: ExecutionPlanQuery): Promise<PageResult<ExecutionPlanSummaryView> | undefined>;
    /**
     * One plan of a project: the current version of series `planId`, or a
     * specific `version`. Plans of other projects are indistinguishable from
     * missing ones.
     */
    getExecutionPlan(principal: OperatorPrincipal, projectId: string, planId: string, version?: number): Promise<ExecutionPlanView | undefined>;
    /**
     * The project's current plan: the current (highest) version of the most
     * recently created plan series, or `null` when the project has no plan.
     * `undefined` (→ 404) when the project is unknown or not accessible.
     */
    getCurrentExecutionPlan(principal: OperatorPrincipal, projectId: string): Promise<ExecutionPlanView | null | undefined>;
    /** The planner's technology catalog (read-only; for planning requests). */
    getTechnologyCatalog(principal: OperatorPrincipal): TechnologyCatalogEntryView[];
    /**
     * Every operator account for Users & Access. Administrators only
     * (`manage_access`) — a PermissionDeniedError maps to 403.
     */
    getOperatorAccounts(principal: OperatorPrincipal): Promise<OperatorAccountView[] | undefined>;
    getAuditEvents(principal: OperatorPrincipal, query?: AuditEventQuery): PageResult<AuditEventView>;
    getDashboardSnapshot(principal: OperatorPrincipal): Promise<DashboardSnapshot>;
    private canSeeProject;
    private authorizeView;
    private visibleTasks;
    private visibleWorkflows;
    private visibleProjects;
    private agentVisible;
    private approvalVisible;
    private auditVisible;
    private taskView;
    private workflowView;
    private approvalLinkedToWorkflow;
    private recentAudit;
    /**
     * The authoritative project → agent membership resolution. An Agent is
     * connected when it explicitly allows the Project, or when it is
     * project-neutral (`allowedProjects` empty). Derived from the live
     * `AgentRegistry` only, so it can never reference a missing Agent.
     */
    private connectedAgentIds;
    private projectView;
}
/** Re-export so callers can `redact` before logging their own diagnostics. */
export { redact };
