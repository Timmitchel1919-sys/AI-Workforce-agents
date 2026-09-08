/**
 * WorkforceQueryService — the read side of the Control Plane.
 *
 * Every method takes an authenticated `OperatorPrincipal`, requires the `view`
 * capability, and returns only data for projects the operator may access.
 * Nothing here mutates state. All secret-bearing fields are redacted.
 */
import {
  type Approval,
  type AuditEventQuery,
  type AuditEventView,
  type AgentView,
  type DashboardSnapshot,
  type HealthStatus,
  type OperatorPrincipal,
  type PageResult,
  type ProjectView,
  type SystemHealth,
  type Task,
  type TaskQuery,
  type TaskView,
  type ToolView,
  type WorkforceStatus,
  type WorkflowView,
  operatorCan,
  operatorCanAccessProject,
  PermissionDeniedError,
  validateOperatorPrincipal,
} from "../../contracts/index.js";
import { now } from "../../core/index.js";
import { type ControlPlaneContext } from "../context.js";
import {
  deriveAgentView,
  deriveApprovalView,
  deriveAuditEventView,
  deriveToolView,
  deriveTaskView,
  deriveWorkflowView,
  paginate,
} from "../derive.js";
import { buildSystemHealth, unverifiedComponent } from "../health.js";
import { redact } from "../redaction.js";

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
                detail: ids.join(", "),
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

    tasks = [...tasks].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

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

  getWorkflows(principal: OperatorPrincipal): WorkflowView[] {
    this.authorizeView(principal);
    return this.visibleWorkflows(principal).map((w) => this.workflowView(w));
  }

  getWorkflow(
    principal: OperatorPrincipal,
    workflowId: string,
  ): WorkflowView | undefined {
    return this.getWorkflows(principal).find(
      (w) => w.workflowId === workflowId,
    );
  }

  /* -------------------------------------------------------------- */
  /* approvals                                                     */
  /* -------------------------------------------------------------- */

  getApprovals(principal: OperatorPrincipal, filter: { status?: string } = {}) {
    this.authorizeView(principal);
    return this.ctx.approvals
      .list()
      .map(deriveApprovalView)
      .filter((view) => (filter.status ? view.status === filter.status : true))
      .filter((view) => this.approvalVisible(principal, view.projectId))
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
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

  /* -------------------------------------------------------------- */
  /* tools                                                         */
  /* -------------------------------------------------------------- */

  getTools(principal: OperatorPrincipal): ToolView[] {
    this.authorizeView(principal);
    const audit = this.ctx.audit.list();
    return this.ctx.tools.list().map((tool) => deriveToolView(tool, audit));
  }

  getTool(principal: OperatorPrincipal, toolId: string): ToolView | undefined {
    return this.getTools(principal).find((t) => t.toolId === toolId);
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
        workflows: this.getWorkflows(principal),
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

    const connectedAgents = this.ctx.agents
      .list()
      .filter(
        (a) =>
          a.allowedProjects.includes(projectId) ||
          a.allowedProjects.length === 0,
      )
      .map((a) => a.id);

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
    };
  }
}

/** Re-export so callers can `redact` before logging their own diagnostics. */
export { redact };
