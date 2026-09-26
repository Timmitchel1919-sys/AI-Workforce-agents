/**
 * WorkforceQueryService — the read side of the Control Plane.
 *
 * Every method takes an authenticated `OperatorPrincipal`, requires the `view`
 * capability, and returns only data for projects the operator may access.
 * Nothing here mutates state. All secret-bearing fields are redacted.
 */
import {
  TOOL_WILDCARD,
  type ExecutionOperationDefinition,
  type ExecutionSession,
  type PreflightResult,
  type Approval,
  type ApprovalQuery,
  type ApprovalView,
  type AuditEventQuery,
  type AuditEventView,
  type AgentView,
  type DashboardSnapshot,
  type ExecutionPlanQuery,
  type OperatorAccountView,
  type TechnologyCatalogEntryView,
  type ExecutionPlanSummaryView,
  type ExecutionPlanView,
  type HealthStatus,
  type OperatorPrincipal,
  type PageResult,
  type ProjectView,
  type SystemHealth,
  type Task,
  type TaskQuery,
  type TaskView,
  type ToolView,
  type WorkflowQuery,
  type WorkflowView,
  type WorkforceStatus,
  type SoftwareFactoryOverview,
  type SoftwareFactoryProgramDetail,
  NotFoundError,
  operatorCan,
  operatorCanAccessProject,
  PermissionDeniedError,
  validateOperatorPrincipal,
} from "../../contracts/index.js";
import type {
  EnvironmentDescriptor,
  EnvironmentInstance,
  HostCapabilitySnapshot,
  HostInstance,
} from "../../contracts/index.js";
import {
  now,
  parseProjectRepositoryRef,
  TechnologyCatalog,
} from "../../core/index.js";
import { type ControlPlaneContext } from "../context.js";
import {
  deriveAgentView,
  deriveApprovalView,
  deriveAuditEventView,
  deriveToolView,
  deriveTaskView,
  deriveWorkflowView,
  MAX_PAGE_SIZE,
  paginate,
} from "../derive.js";
import { buildSystemHealth, unverifiedComponent } from "../health.js";
import { executionPlanSummaryView, executionPlanView } from "../plan-views.js";
import { redact } from "../redaction.js";
import {
  getExecutionOverview,
  getExecutionSessionDetail,
  getProjectReleases,
  getProjectVerifications,
  listExecutionSessions,
} from "./execution-operations-views.js";

export class WorkforceQueryService {
  constructor(private readonly ctx: ControlPlaneContext) {}

  /* -------------------------------------------------------------- */
  /* status + health                                               */
  /* -------------------------------------------------------------- */

  getWorkforceStatus(principal: OperatorPrincipal): WorkforceStatus {
    this.authorizeView(principal);
    const tasks = this.visibleTasks(principal);
    const workflows = this.visibleWorkflows(principal);
    const agents = this.ctx.agents.list();
    const tools = this.ctx.tools.list();
    const projects = this.visibleProjects(principal);

    const byStatus = (status: string) =>
      tasks.filter((t) => t.status === status).length;

    const health = this.getSystemHealth(principal);

    return {
      status: health.status,
      generatedAt: now(),
      counts: {
        activeWorkflows: workflows.filter(
          (w) =>
            w.status === "running" ||
            w.status === "planned" ||
            w.status === "awaiting_approval" ||
            w.status === "blocked",
        ).length,
        queuedTasks: byStatus("queued") + byStatus("created"),
        runningTasks: byStatus("running"),
        blockedTasks: byStatus("blocked"),
        awaitingApproval: byStatus("awaiting_approval"),
        failedTasks: byStatus("failed"),
        completedTasks: byStatus("completed"),
        cancelledTasks: byStatus("cancelled"),
        registeredAgents: agents.length,
        disabledAgents: agents.filter((a) => !this.ctx.agentOps.isEnabled(a.id))
          .length,
        availableTools: tools.length,
        registeredProjects: projects.length,
      },
      recentActivity: this.recentAudit(principal, 15),
    };
  }

  getGraphProjection(
    principal: OperatorPrincipal,
    projectId: string,
    programId: string,
  ): import("../../contracts/index.js").GraphProjection | undefined {
    this.authorizeView(principal);
    if (!this.ctx.softwareFactory) return undefined;
    if (!operatorCanAccessProject(principal, projectId)) return undefined;
    return this.ctx.softwareFactory.getGraphProjection(programId, projectId);
  }

  /* -------------------------------------------------------------- */
  /* software factory (EO-5.1) — read-only views                    */
  /* -------------------------------------------------------------- */

  getSoftwareFactoryOverview(
    principal: OperatorPrincipal,
    projectId?: string,
  ): SoftwareFactoryOverview {
    this.authorizeView(principal);
    if (!this.ctx.softwareFactory) return { programs: [] };
    if (
      projectId !== undefined &&
      !operatorCanAccessProject(principal, projectId)
    ) {
      return { programs: [] };
    }
    const projectIds =
      projectId !== undefined
        ? new Set([projectId])
        : principal.allowedProjects === "*"
          ? undefined
          : new Set(principal.allowedProjects);
    return this.ctx.softwareFactory.overview(projectIds);
  }

  getSoftwareFactoryProgramDetail(
    principal: OperatorPrincipal,
    projectId: string,
    programId: string,
  ): SoftwareFactoryProgramDetail {
    this.authorizeView(principal);
    if (!operatorCanAccessProject(principal, projectId)) {
      throw new NotFoundError("unknown program");
    }
    const detail = this.ctx.softwareFactory?.programDetail(
      programId,
      projectId,
    );
    if (!detail) throw new NotFoundError("unknown program");
    return detail;
  }

  /** @deprecated since Phase 7A — use {@link getSystemHealth}. */
  getHealth(principal: OperatorPrincipal): SystemHealth {
    return this.getSystemHealth(principal);
  }

  getSystemHealth(principal: OperatorPrincipal): SystemHealth {
    this.authorizeView(principal);
    const clock = this.ctx.clock ?? Date.now;
    const probes = [
      {
        name: "application",
        check: () => "healthy" as HealthStatus,
      },
      {
        name: "persistence",
        check: () => {
          try {
            this.ctx.tasks.list();
            this.ctx.workflows.list();
            return { status: "healthy" as HealthStatus, detail: "readable" };
          } catch (error) {
            return {
              status: "unavailable" as HealthStatus,
              detail: error instanceof Error ? error.message : String(error),
            };
          }
        },
      },
      {
        name: "audit",
        check: () => ({
          status: "healthy" as HealthStatus,
          detail: `${this.ctx.audit.list().length} events retained`,
        }),
      },
      {
        name: "tool-registry",
        check: () => ({
          status: "healthy" as HealthStatus,
          detail: `${this.ctx.tools.list().length} tools registered`,
        }),
      },
      {
        name: "projects",
        check: () => {
          const ids = this.ctx.projects.ids();
          return ids.length === 0
            ? {
                status: "degraded" as HealthStatus,
                detail: "no project adapters registered",
              }
            : {
                status: "healthy" as HealthStatus,
                // Count only: project ids are per-operator scoped data.
                detail: `${ids.length} project adapter${ids.length === 1 ? "" : "s"} registered`,
              };
        },
      },
      ...(this.ctx.healthProbes ?? [
        unverifiedComponent(
          "model-provider",
          "no live probe wired; provider health is unknown",
        ),
      ]),
    ];
    return buildSystemHealth(probes, clock);
  }

  /* -------------------------------------------------------------- */
  /* agents                                                        */
  /* -------------------------------------------------------------- */

  getAgents(principal: OperatorPrincipal): AgentView[] {
    this.authorizeView(principal);
    const tasks = this.ctx.tasks.list();
    const audit = this.ctx.audit.list();
    return this.ctx.agents
      .list()
      .filter((agent) => this.agentVisible(principal, agent.allowedProjects))
      .map((agent) =>
        deriveAgentView(agent, tasks, this.ctx.agentOps.get(agent.id), audit),
      );
  }

  getAgent(
    principal: OperatorPrincipal,
    agentId: string,
  ): AgentView | undefined {
    return this.getAgents(principal).find((a) => a.agentId === agentId);
  }

  /* -------------------------------------------------------------- */
  /* tasks                                                         */
  /* -------------------------------------------------------------- */

  getTasks(
    principal: OperatorPrincipal,
    query: TaskQuery = {},
  ): PageResult<TaskView> {
    this.authorizeView(principal);
    let tasks = this.visibleTasks(principal);

    if (query.taskId) tasks = tasks.filter((t) => t.id === query.taskId);
    if (query.projectId)
      tasks = tasks.filter((t) => t.projectId === query.projectId);
    if (query.agentId)
      tasks = tasks.filter((t) => t.assignedAgentId === query.agentId);
    if (query.status) tasks = tasks.filter((t) => t.status === query.status);
    if (query.priority)
      tasks = tasks.filter((t) => t.priority === query.priority);
    if (query.workflowId) {
      tasks = tasks.filter((t) => t.metadata.workflowId === query.workflowId);
    }
    if (query.failedOnly) {
      tasks = tasks.filter(
        (t) => t.status === "failed" || t.status === "blocked",
      );
    }
    if (query.since) tasks = tasks.filter((t) => t.updatedAt >= query.since!);
    if (query.until) tasks = tasks.filter((t) => t.updatedAt <= query.until!);
    if (query.createdAfter)
      tasks = tasks.filter((t) => t.createdAt >= query.createdAfter!);
    if (query.createdBefore)
      tasks = tasks.filter((t) => t.createdAt <= query.createdBefore!);

    tasks = [...tasks].sort((a, b) =>
      a.updatedAt < b.updatedAt
        ? 1
        : a.updatedAt > b.updatedAt
          ? -1
          : b.id.localeCompare(a.id),
    );

    const page = paginate(tasks, query.limit, query.cursor);
    return {
      items: page.items.map((task) => this.taskView(task)),
      total: page.total,
      nextCursor: page.nextCursor,
    };
  }

  getTask(principal: OperatorPrincipal, taskId: string): TaskView | undefined {
    this.authorizeView(principal);
    const task = this.ctx.tasks.get(taskId);
    if (!task || !operatorCanAccessProject(principal, task.projectId)) {
      return undefined;
    }
    return this.taskView(task, { includeInputShape: true });
  }

  /* -------------------------------------------------------------- */
  /* workflows                                                     */
  /* -------------------------------------------------------------- */

  /**
   * Bounded, project-scoped workflow listing. `query.projectId` is evaluated
   * server-side against `workflow.projectId` — the frontend never joins or
   * filters this list client-side. Results are deterministically ordered
   * (`updatedAt` desc, id desc tie-break) and cursor-paginated.
   */
  getWorkflows(
    principal: OperatorPrincipal,
    query: WorkflowQuery = {},
  ): PageResult<WorkflowView> {
    this.authorizeView(principal);
    let workflows = this.visibleWorkflows(principal);

    if (query.projectId) {
      workflows = workflows.filter((w) => w.projectId === query.projectId);
    }

    workflows = [...workflows].sort((a, b) =>
      a.updatedAt < b.updatedAt
        ? 1
        : a.updatedAt > b.updatedAt
          ? -1
          : b.id.localeCompare(a.id),
    );

    const page = paginate(workflows, query.limit, query.cursor);
    return {
      items: page.items.map((workflow) => this.workflowView(workflow)),
      total: page.total,
      nextCursor: page.nextCursor,
    };
  }

  getWorkflow(
    principal: OperatorPrincipal,
    workflowId: string,
  ): WorkflowView | undefined {
    this.authorizeView(principal);
    const workflow = this.ctx.workflows.get(workflowId);
    if (!workflow || !operatorCanAccessProject(principal, workflow.projectId)) {
      return undefined;
    }
    return this.workflowView(workflow);
  }

  /* -------------------------------------------------------------- */
  /* approvals                                                     */
  /* -------------------------------------------------------------- */

  getApprovals(principal: OperatorPrincipal, filter: { status?: string } = {}) {
    this.authorizeView(principal);
    return this.approvalViews()
      .filter((view) => (filter.status ? view.status === filter.status : true))
      .filter((view) => this.approvalVisible(principal, view.projectId))
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  }

  /**
   * The approval queue for the Approvals screen: status/project filters and
   * the shared bounded cursor pagination. Project scope is enforced
   * server-side (a foreign project filter simply yields nothing).
   */
  getApprovalPage(
    principal: OperatorPrincipal,
    query: ApprovalQuery = {},
  ): PageResult<ApprovalView> {
    const views = this.getApprovals(principal, { status: query.status })
      .filter((view) =>
        query.projectId ? view.projectId === query.projectId : true,
      )
      .sort(
        (a, b) =>
          b.requestedAt.localeCompare(a.requestedAt) ||
          b.approvalId.localeCompare(a.approvalId),
      );
    return paginate(views, query.limit, query.cursor);
  }

  /**
   * Approval views with their project resolved: orchestrator/tool approvals
   * only carry a `taskId`, so the project comes from the linked task — an
   * approval must never escape project isolation because its metadata
   * lacked a `projectId`.
   */
  private approvalViews(): ApprovalView[] {
    return this.ctx.approvals.list().map((approval) => {
      const view = deriveApprovalView(approval);
      if (view.projectId || !view.taskId) return view;
      const projectId = this.ctx.tasks.get(view.taskId)?.projectId;
      return projectId ? { ...view, projectId } : view;
    });
  }

  /* -------------------------------------------------------------- */
  /* projects                                                      */
  /* -------------------------------------------------------------- */

  async getProjects(principal: OperatorPrincipal): Promise<ProjectView[]> {
    this.authorizeView(principal);
    const out: ProjectView[] = [];
    for (const registration of this.ctx.projects.list()) {
      if (!operatorCanAccessProject(principal, registration.projectId)) {
        continue;
      }
      out.push(await this.projectView(registration.projectId));
    }
    return out;
  }

  async getProject(
    principal: OperatorPrincipal,
    projectId: string,
  ): Promise<ProjectView | undefined> {
    this.authorizeView(principal);
    if (
      !this.ctx.projects.has(projectId) ||
      !operatorCanAccessProject(principal, projectId)
    ) {
      return undefined;
    }
    return this.projectView(projectId);
  }

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
  async getProjectAgents(
    principal: OperatorPrincipal,
    projectId: string,
  ): Promise<AgentView[] | undefined> {
    this.authorizeView(principal);
    if (
      !this.ctx.projects.has(projectId) ||
      !operatorCanAccessProject(principal, projectId)
    ) {
      return undefined;
    }
    const tasks = this.ctx.tasks.list();
    const audit = this.ctx.audit.list();
    const byId = new Map(this.ctx.agents.list().map((a) => [a.id, a] as const));
    return this.connectedAgentIds(projectId)
      .map((agentId) => byId.get(agentId))
      .filter(
        (agent): agent is NonNullable<typeof agent> => agent !== undefined,
      )
      .map((agent) =>
        deriveAgentView(agent, tasks, this.ctx.agentOps.get(agent.id), audit),
      );
  }

  /* -------------------------------------------------------------- */
  /* tools                                                         */
  /* -------------------------------------------------------------- */

  getTools(principal: OperatorPrincipal): ToolView[] {
    this.authorizeView(principal);
    const audit = this.ctx.audit.list();
    return this.ctx.tools.list().map((tool) => {
      const view = deriveToolView(tool, audit);
      // Project isolation: never reveal project ids outside the operator's scope.
      return principal.allowedProjects === "*"
        ? view
        : {
            ...view,
            allowedProjects: view.allowedProjects.filter(
              (projectId) =>
                projectId === TOOL_WILDCARD ||
                this.canSeeProject(principal, projectId),
            ),
          };
    });
  }

  getTool(principal: OperatorPrincipal, toolId: string): ToolView | undefined {
    return this.getTools(principal).find((t) => t.toolId === toolId);
  }

  /* -------------------------------------------------------------- */
  /* environments                                                  */
  /* -------------------------------------------------------------- */

  getEnvironmentDescriptors(
    principal: OperatorPrincipal,
  ): EnvironmentDescriptor[] {
    this.authorizeView(principal);
    return this.ctx.environments?.listDescriptors() ?? [];
  }

  getEnvironmentDescriptor(
    principal: OperatorPrincipal,
    id: string,
  ): EnvironmentDescriptor | undefined {
    this.authorizeView(principal);
    return this.ctx.environments?.getDescriptor(id);
  }

  getEnvironmentInstances(principal: OperatorPrincipal): EnvironmentInstance[] {
    this.authorizeView(principal);
    return this.ctx.environments?.listInstances() ?? [];
  }

  getEnvironmentInstance(
    principal: OperatorPrincipal,
    id: string,
  ): EnvironmentInstance | undefined {
    this.authorizeView(principal);
    return this.ctx.environments?.getInstance(id);
  }

  getHosts(principal: OperatorPrincipal): HostInstance[] {
    this.authorizeView(principal);
    return this.ctx.environments?.listHosts() ?? [];
  }

  getHost(
    principal: OperatorPrincipal,
    hostId: string,
  ): HostInstance | undefined {
    this.authorizeView(principal);
    return this.ctx.environments?.getHost(hostId);
  }

  getHostCapabilitySnapshot(
    principal: OperatorPrincipal,
    hostId: string,
  ): HostCapabilitySnapshot | undefined {
    this.authorizeView(principal);
    const host = this.ctx.environments?.getHost(hostId);
    if (!host) return undefined;
    return { hostId, host, capabilities: host.capabilities };
  }

  /* -------------------------------------------------------------- */
  /* execution control boundary (EO-4.1) — never executes           */
  /* -------------------------------------------------------------- */

  /**
   * Pre-flight for one plan stage: ELIGIBLE or DENIED with reason codes.
   * Denials are data (200), not errors. `undefined` → execution not configured.
   */
  async executionPreflight(
    principal: OperatorPrincipal,
    request: unknown,
  ): Promise<PreflightResult | undefined> {
    validateOperatorPrincipal(principal);
    return this.ctx.execution?.preflight(principal, request);
  }

  getExecutionOperations(
    principal: OperatorPrincipal,
  ): ExecutionOperationDefinition[] {
    this.authorizeView(principal);
    return this.ctx.execution?.listOperations(principal) ?? [];
  }

  async getExecutionSession(
    principal: OperatorPrincipal,
    sessionId: string,
  ): Promise<ExecutionSession | undefined> {
    this.authorizeView(principal);
    return this.ctx.execution?.getSession(principal, sessionId);
  }

  async getExecutionSessions(
    principal: OperatorPrincipal,
    projectId: string,
  ): Promise<ExecutionSession[] | undefined> {
    this.authorizeView(principal);
    return this.ctx.execution?.listSessions(principal, projectId);
  }

  /* -------------------------------------------------------------- */
  /* EO-4.7 Execution Control Center — authoritative, bounded       */
  /* -------------------------------------------------------------- */

  async getExecutionSessionPage(
    principal: OperatorPrincipal,
    projectId: string,
    query: { status?: string; limit?: number; offset?: number } = {},
  ) {
    this.authorizeView(principal);
    return listExecutionSessions(this.ctx, principal, projectId, query);
  }

  async getExecutionOverview(principal: OperatorPrincipal, projectId: string) {
    this.authorizeView(principal);
    return getExecutionOverview(this.ctx, principal, projectId);
  }

  async getExecutionSessionDetail(
    principal: OperatorPrincipal,
    projectId: string,
    sessionId: string,
    query: { timelineLimit?: number; timelineOffset?: number } = {},
  ) {
    this.authorizeView(principal);
    return getExecutionSessionDetail(
      this.ctx,
      principal,
      projectId,
      sessionId,
      query,
    );
  }

  async getProjectVerifications(
    principal: OperatorPrincipal,
    projectId: string,
  ) {
    this.authorizeView(principal);
    if (
      !this.ctx.projects.get(projectId) ||
      !operatorCanAccessProject(principal, projectId)
    )
      return undefined;
    return getProjectVerifications(this.ctx, principal, projectId);
  }

  async getProjectReleases(principal: OperatorPrincipal, projectId: string) {
    this.authorizeView(principal);
    if (
      !this.ctx.projects.get(projectId) ||
      !operatorCanAccessProject(principal, projectId)
    )
      return undefined;
    return getProjectReleases(this.ctx, principal, projectId);
  }

  /** EO-4.5 environment execution status (real runners only count). */
  getExecutionEnvironments(principal: OperatorPrincipal) {
    this.authorizeView(principal);
    return {
      configured: Boolean(this.ctx.environmentAdapters),
      families: this.ctx.environmentAdapters?.status() ?? [],
    };
  }

  /* -------------------------------------------------------------- */
  /* execution plans (EO-3.1) — planning state only                */
  /* -------------------------------------------------------------- */

  /**
   * Plan versions of one project, newest first, cursor-paginated with the
   * shared page-size bounds. `undefined` when the project does not exist or
   * the operator may not access it (→ 404, no existence leak).
   */
  async getExecutionPlans(
    principal: OperatorPrincipal,
    projectId: string,
    query: ExecutionPlanQuery = {},
  ): Promise<PageResult<ExecutionPlanSummaryView> | undefined> {
    this.authorizeView(principal);
    if (!this.canSeeProject(principal, projectId)) return undefined;
    const planning = this.ctx.planning;
    // Fresh from the authoritative store, scoped to this project only.
    if (planning) await planning.refreshProject(projectId);
    const all = planning ? planning.listByProject(projectId) : [];
    const plans = query.planId
      ? all.filter((plan) => plan.planId === query.planId)
      : all;
    const latest = new Map<string, number>();
    for (const plan of all) {
      latest.set(
        plan.planId,
        Math.max(latest.get(plan.planId) ?? 0, plan.version),
      );
    }
    const page = paginate(plans, query.limit, query.cursor);
    return {
      ...page,
      items: page.items.map((plan) =>
        executionPlanSummaryView(
          plan,
          latest.get(plan.planId) === plan.version,
        ),
      ),
    };
  }

  /**
   * One plan of a project: the current version of series `planId`, or a
   * specific `version`. Plans of other projects are indistinguishable from
   * missing ones.
   */
  async getExecutionPlan(
    principal: OperatorPrincipal,
    projectId: string,
    planId: string,
    version?: number,
  ): Promise<ExecutionPlanView | undefined> {
    this.authorizeView(principal);
    if (!this.canSeeProject(principal, projectId)) return undefined;
    const planning = this.ctx.planning;
    if (!planning) return undefined;
    await planning.refreshProject(projectId);
    const latest = planning.latest(planId);
    if (!latest || latest.projectId !== projectId) return undefined;
    const plan =
      version === undefined ? latest : planning.get(`${planId}@v${version}`);
    if (!plan || plan.projectId !== projectId) return undefined;
    return executionPlanView(plan, plan.version === latest.version);
  }

  /**
   * The project's current plan: the current (highest) version of the most
   * recently created plan series, or `null` when the project has no plan.
   * `undefined` (→ 404) when the project is unknown or not accessible.
   */
  async getCurrentExecutionPlan(
    principal: OperatorPrincipal,
    projectId: string,
  ): Promise<ExecutionPlanView | null | undefined> {
    this.authorizeView(principal);
    if (!this.canSeeProject(principal, projectId)) return undefined;
    const planning = this.ctx.planning;
    if (!planning) return null;
    await planning.refreshProject(projectId);
    const newestSeries = planning
      .listByProject(projectId)
      .filter((plan) => plan.version === 1)[0];
    const current = newestSeries && planning.latest(newestSeries.planId);
    return current ? executionPlanView(current, true) : null;
  }

  /** The planner's technology catalog (read-only; for planning requests). */
  getTechnologyCatalog(
    principal: OperatorPrincipal,
  ): TechnologyCatalogEntryView[] {
    this.authorizeView(principal);
    return (this.ctx.technologyCatalog ?? new TechnologyCatalog())
      .list()
      .map((profile) => ({
        id: profile.id,
        label: profile.label,
        componentKinds: [...profile.componentKinds],
        platforms: [...profile.platforms],
      }));
  }

  /* -------------------------------------------------------------- */
  /* operator access (AUTHZ-1)                                     */
  /* -------------------------------------------------------------- */

  /**
   * Every operator account for Users & Access. Administrators only
   * (`manage_access`) — a PermissionDeniedError maps to 403.
   */
  async getOperatorAccounts(
    principal: OperatorPrincipal,
  ): Promise<OperatorAccountView[] | undefined> {
    this.authorizeView(principal);
    if (!operatorCan(principal, "manage_access")) {
      throw new PermissionDeniedError(
        "managing access requires the administrator role",
      );
    }
    return this.ctx.access?.listAccounts(principal);
  }

  /* -------------------------------------------------------------- */
  /* audit                                                         */
  /* -------------------------------------------------------------- */

  getAuditEvents(
    principal: OperatorPrincipal,
    query: AuditEventQuery = {},
  ): PageResult<AuditEventView> {
    this.authorizeView(principal);
    let views = this.ctx.audit
      .list()
      .map(deriveAuditEventView)
      .filter((view) => this.auditVisible(principal, view.projectId));

    if (query.type) views = views.filter((v) => v.type === query.type);
    if (query.agentId) views = views.filter((v) => v.agentId === query.agentId);
    if (query.projectId)
      views = views.filter((v) => v.projectId === query.projectId);
    if (query.taskId) views = views.filter((v) => v.taskId === query.taskId);
    if (query.workflowId)
      views = views.filter((v) => v.workflowId === query.workflowId);
    if (query.toolId) views = views.filter((v) => v.toolId === query.toolId);
    if (query.actor) views = views.filter((v) => v.actor === query.actor);
    if (query.correlationId)
      views = views.filter((v) => v.correlationId === query.correlationId);
    if (query.outcome) views = views.filter((v) => v.outcome === query.outcome);
    if (query.since) views = views.filter((v) => v.timestamp >= query.since!);
    if (query.until) views = views.filter((v) => v.timestamp <= query.until!);

    views = [...views].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    const page = paginate(views, query.limit, query.cursor);
    return {
      items: page.items,
      total: page.total,
      nextCursor: page.nextCursor,
    };
  }

  /* -------------------------------------------------------------- */
  /* dashboard bundle                                              */
  /* -------------------------------------------------------------- */

  async getDashboardSnapshot(
    principal: OperatorPrincipal,
  ): Promise<DashboardSnapshot> {
    this.authorizeView(principal);
    try {
      return {
        generatedAt: now(),
        operator: { id: principal.id, role: principal.role },
        status: this.getWorkforceStatus(principal),
        health: this.getSystemHealth(principal),
        agents: this.getAgents(principal),
        workflows: this.getWorkflows(principal, { limit: MAX_PAGE_SIZE }).items,
        tasks: this.getTasks(principal, { limit: 50 }).items,
        approvals: this.getApprovals(principal),
        projects: await this.getProjects(principal),
        tools: this.getTools(principal),
        recentAudit: this.getAuditEvents(principal, { limit: 30 }).items,
      };
    } catch (error) {
      return {
        generatedAt: now(),
        operator: { id: principal.id, role: principal.role },
        status: this.getWorkforceStatus(principal),
        health: this.getSystemHealth(principal),
        agents: [],
        workflows: [],
        tasks: [],
        approvals: [],
        projects: [],
        tools: [],
        recentAudit: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /* -------------------------------------------------------------- */
  /* internals                                                     */
  /* -------------------------------------------------------------- */

  private canSeeProject(principal: OperatorPrincipal, projectId: string) {
    return (
      this.ctx.projects.has(projectId) &&
      operatorCanAccessProject(principal, projectId)
    );
  }

  private authorizeView(principal: OperatorPrincipal): void {
    validateOperatorPrincipal(principal);
    if (!operatorCan(principal, "view")) {
      throw new PermissionDeniedError(
        `operator "${principal.id}" (${principal.role}) may not view the control plane`,
      );
    }
  }

  private visibleTasks(principal: OperatorPrincipal): Task[] {
    return this.ctx.tasks
      .list()
      .filter((t) => operatorCanAccessProject(principal, t.projectId));
  }

  private visibleWorkflows(principal: OperatorPrincipal) {
    return this.ctx.workflows
      .list()
      .filter((w) => operatorCanAccessProject(principal, w.projectId));
  }

  private visibleProjects(principal: OperatorPrincipal) {
    return this.ctx.projects
      .list()
      .filter((p) => operatorCanAccessProject(principal, p.projectId));
  }

  private agentVisible(
    principal: OperatorPrincipal,
    allowedProjects: readonly string[],
  ): boolean {
    if (principal.allowedProjects === "*") return true;
    if (allowedProjects.length === 0) return true; // project-neutral agent
    return allowedProjects.some((p) => operatorCanAccessProject(principal, p));
  }

  private approvalVisible(
    principal: OperatorPrincipal,
    projectId: string | undefined,
  ): boolean {
    return !projectId || operatorCanAccessProject(principal, projectId);
  }

  private auditVisible(
    principal: OperatorPrincipal,
    projectId: string | undefined,
  ): boolean {
    return !projectId || operatorCanAccessProject(principal, projectId);
  }

  private taskView(task: Task, options: { includeInputShape?: boolean } = {}) {
    const workflowId =
      typeof task.metadata.workflowId === "string"
        ? task.metadata.workflowId
        : undefined;
    const workflow = workflowId
      ? this.ctx.workflows.get(workflowId)
      : undefined;
    const approval = task.approvalId
      ? this.ctx.approvals.get(task.approvalId)
      : undefined;
    return deriveTaskView(task, workflow, approval, options);
  }

  private workflowView(workflow: import("../../contracts/index.js").Workflow) {
    const control = this.ctx.workflowControl.get(workflow.id);
    const approvals = this.ctx.approvals
      .list()
      .filter((a) => this.approvalLinkedToWorkflow(a, workflow.id));
    return deriveWorkflowView(workflow, control, approvals);
  }

  private approvalLinkedToWorkflow(
    approval: Approval,
    workflowId: string,
  ): boolean {
    const meta = approval.decisionMetadata ?? {};
    if (meta.workflowId === workflowId) return true;
    const taskId = typeof meta.taskId === "string" ? meta.taskId : undefined;
    if (!taskId) return false;
    const task = this.ctx.tasks.get(taskId);
    return task?.metadata.workflowId === workflowId;
  }

  private recentAudit(
    principal: OperatorPrincipal,
    limit: number,
  ): AuditEventView[] {
    return [...this.getAuditEvents(principal, { limit }).items];
  }

  /**
   * The authoritative project → agent membership resolution. An Agent is
   * connected when it explicitly allows the Project, or when it is
   * project-neutral (`allowedProjects` empty). Derived from the live
   * `AgentRegistry` only, so it can never reference a missing Agent.
   */
  private connectedAgentIds(projectId: string): string[] {
    return this.ctx.agents
      .list()
      .filter(
        (a) =>
          a.allowedProjects.includes(projectId) ||
          a.allowedProjects.length === 0,
      )
      .map((a) => a.id);
  }

  private async projectView(projectId: string): Promise<ProjectView> {
    const registration = this.ctx.projects.require(projectId);
    let adapterStatus: HealthStatus = "healthy";
    let capabilities: ProjectView["capabilities"] = [];
    try {
      const described = await registration.adapter.describe();
      capabilities = described.capabilities.map((c) => ({
        operation: c.operation,
        description: c.description,
        action: c.action,
      }));
    } catch (error) {
      adapterStatus = "unavailable";
      capabilities = [];
      void error;
    }

    const connectedAgents = this.connectedAgentIds(projectId);

    const workflows = this.ctx.workflows
      .list()
      .filter((w) => w.projectId === projectId);
    const activeWorkflows = workflows.filter(
      (w) =>
        w.status === "running" ||
        w.status === "planned" ||
        w.status === "awaiting_approval" ||
        w.status === "blocked",
    ).length;

    const recentTaskIds = this.ctx.tasks
      .list()
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, 10)
      .map((t) => t.id);

    const recentActivity = this.ctx.audit
      .list()
      .filter((e) => e.projectId === projectId)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 15)
      .map(deriveAuditEventView);

    const status: ProjectView["status"] =
      adapterStatus === "unavailable" ? "unavailable" : "available";

    // Only a validated, credential-free reference is ever exposed; anything
    // else in registration metadata stays server-side.
    const repository = parseProjectRepositoryRef(
      registration.metadata.repository,
    );

    return {
      projectId,
      displayName: registration.displayName,
      status,
      adapterStatus,
      capabilities,
      connectedAgents,
      activeWorkflows,
      recentTaskIds,
      recentActivity,
      ...(repository ? { repository } : {}),
    };
  }
}

/** Re-export so callers can `redact` before logging their own diagnostics. */
export { redact };
