/**
 * WorkforceQueryService — the read side of the Control Plane.
 *
 * Every method takes an authenticated `OperatorPrincipal`, requires the `view`
 * capability, and returns only data for projects the operator may access.
 * Nothing here mutates state. All secret-bearing fields are redacted.
 */
import { type AuditEventQuery, type AuditEventView, type AgentView, type DashboardSnapshot, type ExecutionPlanQuery, type OperatorAccountView, type ExecutionPlanSummaryView, type ExecutionPlanView, type OperatorPrincipal, type PageResult, type ProjectView, type SystemHealth, type TaskQuery, type TaskView, type ToolView, type WorkflowQuery, type WorkflowView, type WorkforceStatus } from "../../contracts/index.js";
import type { EnvironmentDescriptor, EnvironmentInstance, HostCapabilitySnapshot, HostInstance } from "../../contracts/index.js";
import { type ControlPlaneContext } from "../context.js";
import { redact } from "../redaction.js";
export declare class WorkforceQueryService {
    private readonly ctx;
    constructor(ctx: ControlPlaneContext);
    getWorkforceStatus(principal: OperatorPrincipal): WorkforceStatus;
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
    }): import("../../contracts/control.js").ApprovalView[];
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
