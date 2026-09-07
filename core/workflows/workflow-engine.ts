/**
 * WorkflowEngine — coordinates a multi-agent task graph.
 *
 * It is a thin scheduler: it decides *which* ready spec to dispatch next and
 * *what happens* to the graph when a task completes, fails, or needs approval.
 * It never talks to a model, a tool, or a credential itself — every task goes
 * through the existing `Orchestrator` (permission gate → approval gate →
 * `RoutingAgentExecutor`), so a workflow inherits all of Phase 2A–4's
 * enforcement for free. Agent assignment is independently re-validated
 * (`assignAgent`) — a Project-Manager-recommended assignment is never trusted
 * blindly.
 */
import {
  type ProjectManagerDecision,
  type Task,
  type Workflow,
  type WorkflowDraft,
  type WorkflowResult,
  type WorkflowTaskResultSummary,
  type WorkflowTaskSpecDraft,
  AgentExecutionError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
  validateProjectManagerDecision,
} from "../../contracts/index.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { AuditLog } from "../audit/audit-log.js";
import { HandoffSystem } from "../handoffs/handoff-system.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { PermissionSystem } from "../permissions/permission-system.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { WorkflowSystem } from "./workflow-system.js";
import {
  assignAgent,
  computeReadySpecs,
  extractFailureReason,
  extractToolCallCount,
  hasActionableWork,
  shouldRetry,
} from "./workflow-graph.js";

export interface WorkflowEngineDeps {
  registry: AgentRegistry;
  workflows: WorkflowSystem;
  orchestrator: Orchestrator;
  handoffs: HandoffSystem;
  audit: AuditLog;
  permissions: PermissionSystem;
  /** Used only for the assignment pre-check when a spec declares `expectedTools`. */
  toolRegistry?: ToolRegistry;
  clock?: () => number;
  /** Agent id that runs `planFromObjective`. Defaults to `"project-manager-agent"`. */
  projectManagerAgentId?: string;
}

export interface PlanFromObjectiveInput {
  name: string;
  description: string;
  projectId: string;
  participatingAgents: readonly string[];
  objective: string;
  constraints?: readonly string[];
  availableAgents?: readonly string[];
  successCriteria?: readonly string[];
  failureBehavior?: WorkflowDraft["failureBehavior"];
  limits?: WorkflowDraft["limits"];
  retryPolicy?: WorkflowDraft["retryPolicy"];
  metadata?: Record<string, unknown>;
}

export class WorkflowEngine {
  private readonly registry: AgentRegistry;
  private readonly workflows: WorkflowSystem;
  private readonly orchestrator: Orchestrator;
  private readonly handoffs: HandoffSystem;
  private readonly audit: AuditLog;
  private readonly permissions: PermissionSystem;
  private readonly toolRegistry: ToolRegistry | undefined;
  private readonly clock: () => number;
  private readonly projectManagerAgentId: string;

  constructor(deps: WorkflowEngineDeps) {
    this.registry = deps.registry;
    this.workflows = deps.workflows;
    this.orchestrator = deps.orchestrator;
    this.handoffs = deps.handoffs;
    this.audit = deps.audit;
    this.permissions = deps.permissions;
    this.toolRegistry = deps.toolRegistry;
    this.clock = deps.clock ?? Date.now;
    this.projectManagerAgentId =
      deps.projectManagerAgentId ?? "project-manager-agent";
  }

  /** Validate, create, and run a fully-authored workflow. */
  async submit(draft: WorkflowDraft): Promise<Workflow> {
    const workflow = this.workflows.create(draft);
    this.emit(workflow, "workflow_created", {});
    this.emit(workflow, "workflow_validated", {
      taskCount: workflow.tasks.length,
    });
    return this.run(workflow.id);
  }

  /** Start (or continue) scheduling a previously created workflow. */
  async run(workflowId: string): Promise<Workflow> {
    let workflow = this.workflows.require(workflowId);
    if (workflow.status === "created") {
      workflow = this.workflows.transition(workflow.id, "planned");
    }
    if (workflow.status === "planned") {
      workflow = this.workflows.transition(workflow.id, "running");
      this.emit(workflow, "workflow_started", {});
    }
    if (workflow.status !== "running") {
      throw new StateTransitionError(
        `workflow ${workflowId} is not runnable from status ${workflow.status}`,
      );
    }
    return this.schedule(workflow, this.clock());
  }

  /** Re-enter a workflow parked in `awaiting_approval` once decisions exist. */
  async resume(workflowId: string): Promise<Workflow> {
    let workflow = this.workflows.require(workflowId);
    if (workflow.status !== "awaiting_approval") {
      throw new StateTransitionError(
        `workflow ${workflowId} is not awaiting approval (status: ${workflow.status})`,
      );
    }
    const parked = workflow.taskRecords.filter(
      (r) => r.status === "awaiting_approval",
    );
    workflow = this.workflows.transition(workflow.id, "running");
    for (const record of parked) {
      if (!record.taskId) continue;
      const task = await this.orchestrator.resume(record.taskId);
      workflow = this.applyTaskOutcome(workflow, record.specId, task);
      if (workflow.status !== "running") return workflow;
    }
    return this.schedule(workflow, this.clock());
  }

  /**
   * Run the Project Manager once to decompose a high-level objective, validate
   * every recommendation, and build + run the resulting workflow. `depth` (for
   * nested calls) is checked against `limits.maxDelegationDepth`.
   */
  async planFromObjective(
    input: PlanFromObjectiveInput,
    depth = 0,
  ): Promise<Workflow> {
    const maxDepth = input.limits?.maxDelegationDepth ?? 1;
    if (depth >= maxDepth) {
      throw new ValidationError(
        `planFromObjective: delegation depth ${depth} would exceed maxDelegationDepth (${maxDepth})`,
      );
    }
    if (!this.registry.has(this.projectManagerAgentId)) {
      throw new NotFoundError(
        `project manager agent "${this.projectManagerAgentId}" is not registered`,
      );
    }

    const planningTask = await this.orchestrator.submit({
      type: "project-manager-plan",
      description: `Decompose: ${input.objective}`,
      projectId: input.projectId,
      input: {
        mode: "decompose",
        objective: input.objective,
        constraints: input.constraints ?? [],
        availableAgents: input.availableAgents ?? input.participatingAgents,
      },
    });

    if (planningTask.status !== "completed") {
      throw new AgentExecutionError(
        this.projectManagerAgentId,
        "internal_error",
        `planning task did not complete (status: ${planningTask.status})`,
        { taskId: planningTask.id },
      );
    }
    const decision = planningTask.output;
    validateProjectManagerDecision(decision);
    const plan = decision as ProjectManagerDecision;

    const tasks: WorkflowTaskSpecDraft[] = plan.subtasks.map((sub) => ({
      id: sub.id,
      type: sub.type,
      description: sub.description,
      agentId: sub.recommendedAgentId,
      capability: sub.recommendedCapability,
      dependsOn: sub.dependsOn,
      acceptanceCriteria: sub.acceptanceCriteria,
      input: sub.input,
    }));

    return this.submit({
      name: input.name,
      description: input.description,
      projectId: input.projectId,
      participatingAgents: input.participatingAgents,
      tasks,
      successCriteria: input.successCriteria,
      failureBehavior: input.failureBehavior,
      limits: input.limits,
      retryPolicy: input.retryPolicy,
      metadata: { ...input.metadata, planningTaskId: planningTask.id },
    });
  }

  /* -------------------------------------------------------------- */
  /* scheduling                                                     */
  /* -------------------------------------------------------------- */

  private async schedule(
    workflow: Workflow,
    startedAtMs: number,
  ): Promise<Workflow> {
    // A generous but finite ceiling on scheduling passes — belt-and-braces
    // against a logic error causing a spin, independent of maxDurationMs.
    const maxPasses =
      workflow.tasks.length * (workflow.retryPolicy.maxRetries + 1) + 5;

    for (let pass = 0; pass < maxPasses; pass++) {
      if (this.clock() - startedAtMs > workflow.limits.maxDurationMs) {
        return this.fail(workflow, "limit_exceeded: maxDurationMs");
      }

      const ready = computeReadySpecs(workflow);
      if (ready.length === 0) {
        if (!hasActionableWork(workflow)) {
          return this.finalize(workflow);
        }
        // Nothing ready but something is awaiting approval: pause here.
        if (
          workflow.taskRecords.some((r) => r.status === "awaiting_approval")
        ) {
          return this.workflows.transition(workflow.id, "awaiting_approval");
        }
        return this.finalize(workflow);
      }

      for (const spec of ready) {
        if (
          workflow.counters.agentExecutions >=
          workflow.limits.maxAgentExecutions
        ) {
          return this.fail(workflow, "limit_exceeded: maxAgentExecutions");
        }

        const assignment = assignAgent(
          spec,
          workflow,
          this.registry,
          this.permissions,
          this.toolRegistry,
        );
        this.emit(workflow, "agent_assigned", {
          specId: spec.id,
          agentId: assignment.agentId,
          validated: assignment.validated,
          reason: assignment.reason,
        });

        if (!assignment.validated) {
          workflow = this.workflows.updateTaskRecord(workflow.id, spec.id, {
            status: "blocked",
            error: assignment.reason,
          });
          this.emit(workflow, "task_blocked", {
            specId: spec.id,
            reason: assignment.reason,
          });
          workflow = this.propagateSkip(workflow, spec.id);
          if (workflow.failureBehavior === "abort") {
            return this.fail(
              workflow,
              `assignment invalid for "${spec.id}": ${assignment.reason}`,
            );
          }
          continue;
        }

        workflow = await this.dispatch(workflow, spec, assignment.agentId!);
        if (workflow.status !== "running") return workflow;
      }
    }
    return this.fail(workflow, "internal_error: scheduling did not converge");
  }

  private async dispatch(
    workflow: Workflow,
    spec: Workflow["tasks"][number],
    agentId: string,
  ): Promise<Workflow> {
    workflow = await this.ensureHandoffs(workflow, spec, agentId);
    if (workflow.counters.handoffs > workflow.limits.maxHandoffs) {
      return this.fail(workflow, "limit_exceeded: maxHandoffs");
    }

    this.emit(workflow, "task_created", { specId: spec.id, agentId });
    const task = await this.orchestrator.submit({
      type: spec.type,
      description: spec.description,
      projectId: workflow.projectId,
      input: spec.input,
      priority: spec.priority,
      requiredPermissions: spec.requiredPermissions,
      metadata: { workflowId: workflow.id, specId: spec.id },
    });
    workflow = this.workflows.incrementCounter(workflow.id, "agentExecutions");
    workflow = this.workflows.incrementCounter(workflow.id, "tasksCreated");
    workflow = this.workflows.incrementCounter(
      workflow.id,
      "toolCalls",
      extractToolCallCount(task.output),
    );
    this.emit(workflow, "task_started", {
      specId: spec.id,
      agentId,
      taskId: task.id,
    });
    if (workflow.counters.toolCalls > workflow.limits.maxToolCalls) {
      return this.fail(workflow, "limit_exceeded: maxToolCalls");
    }

    return this.applyTaskOutcome(workflow, spec.id, task);
  }

  private applyTaskOutcome(
    workflow: Workflow,
    specId: string,
    task: Task,
  ): Workflow {
    const spec = workflow.tasks.find((t) => t.id === specId)!;

    if (task.status === "awaiting_approval") {
      workflow = this.workflows.updateTaskRecord(workflow.id, specId, {
        status: "awaiting_approval",
        taskId: task.id,
        assignedAgentId: task.assignedAgentId,
      });
      this.emit(workflow, "approval_requested", { specId, taskId: task.id });
      return workflow;
    }

    if (task.status === "completed") {
      workflow = this.workflows.updateTaskRecord(workflow.id, specId, {
        status: "completed",
        taskId: task.id,
        assignedAgentId: task.assignedAgentId,
        output: task.output,
      });
      this.emit(workflow, "task_completed", { specId, taskId: task.id });
      if (spec.type === "qa") {
        const verdict = (task.output as { verdict?: string } | undefined)
          ?.verdict;
        this.emit(workflow, verdict === "pass" ? "qa_passed" : "qa_failed", {
          specId,
          verdict,
        });
      }
      return workflow;
    }

    // failed / blocked from the orchestrator itself
    const record = workflow.taskRecords.find((r) => r.specId === specId)!;
    const message = task.errors.at(-1) ?? `task ended in status ${task.status}`;
    const reason = extractFailureReason(message);

    if (shouldRetry(workflow.retryPolicy, reason, record.retryCount)) {
      workflow = this.workflows.updateTaskRecord(workflow.id, specId, {
        status: "pending",
        taskId: task.id,
        retryCount: record.retryCount + 1,
        error: message,
      });
      workflow = this.workflows.incrementCounter(workflow.id, "retries");
      this.emit(workflow, "retry_requested", {
        specId,
        attempt: record.retryCount + 1,
        reason,
      });
      return workflow;
    }

    workflow = this.workflows.updateTaskRecord(workflow.id, specId, {
      status: "failed",
      taskId: task.id,
      assignedAgentId: task.assignedAgentId,
      error: message,
    });
    this.emit(workflow, "task_failed", {
      specId,
      taskId: task.id,
      reason,
      message,
    });
    workflow = this.propagateSkip(workflow, specId);
    if (workflow.failureBehavior === "abort") {
      return this.fail(workflow, `task "${specId}" failed: ${message}`);
    }
    return workflow;
  }

  /* -------------------------------------------------------------- */
  /* handoffs                                                       */
  /* -------------------------------------------------------------- */

  private async ensureHandoffs(
    workflow: Workflow,
    spec: Workflow["tasks"][number],
    destinationAgentId: string,
  ): Promise<Workflow> {
    for (const depId of spec.dependsOn) {
      const depRecord = workflow.taskRecords.find((r) => r.specId === depId);
      if (
        !depRecord ||
        depRecord.status !== "completed" ||
        !depRecord.taskId ||
        !depRecord.assignedAgentId ||
        depRecord.assignedAgentId === destinationAgentId ||
        spec.acceptanceCriteria.length === 0
      ) {
        continue;
      }
      const alreadyHandedOff = this.handoffs
        .forTask(depRecord.taskId)
        .some(
          (h) =>
            h.destinationAgentId === destinationAgentId &&
            h.sourceAgentId === depRecord.assignedAgentId,
        );
      if (alreadyHandedOff) continue;

      const depSpec = workflow.tasks.find((t) => t.id === depId)!;
      const proposed = this.handoffs.propose({
        taskId: depRecord.taskId,
        sourceAgentId: depRecord.assignedAgentId,
        destinationAgentId,
        completedWork: `${depSpec.description} (spec "${depId}")`,
        remainingWork: spec.description,
        acceptanceCriteria: spec.acceptanceCriteria,
        artifacts: [depRecord.taskId],
        context: {
          workflowId: workflow.id,
          fromSpecId: depId,
          toSpecId: spec.id,
        },
      });
      const accepted = this.handoffs.accept(proposed.id);
      this.emit(workflow, "handoff_created", {
        handoffId: accepted.id,
        fromSpecId: depId,
        toSpecId: spec.id,
        sourceAgentId: depRecord.assignedAgentId,
        destinationAgentId,
      });
      this.emit(workflow, "handoff_accepted", {
        handoffId: accepted.id,
        specId: spec.id,
      });
      workflow = this.workflows.updateTaskRecord(workflow.id, spec.id, {
        handoffId: accepted.id,
      });
      workflow = this.workflows.incrementCounter(workflow.id, "handoffs");
    }
    return workflow;
  }

  /* -------------------------------------------------------------- */
  /* completion / failure                                           */
  /* -------------------------------------------------------------- */

  private propagateSkip(workflow: Workflow, failedSpecId: string): Workflow {
    const toSkip = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const spec of workflow.tasks) {
        const record = workflow.taskRecords.find((r) => r.specId === spec.id)!;
        if (record.status !== "pending" || toSkip.has(spec.id)) continue;
        const blocked = spec.dependsOn.some(
          (dep) => dep === failedSpecId || toSkip.has(dep),
        );
        if (blocked) {
          toSkip.add(spec.id);
          changed = true;
        }
      }
    }
    for (const specId of toSkip) {
      workflow = this.workflows.updateTaskRecord(workflow.id, specId, {
        status: "skipped",
        error: `blocked: an upstream dependency did not complete`,
      });
      this.emit(workflow, "task_blocked", {
        specId,
        reason: "upstream_failure",
      });
    }
    return workflow;
  }

  private fail(workflow: Workflow, reason: string): Workflow {
    const next = this.workflows.transition(workflow.id, "failed", {
      error: reason,
    });
    this.emit(next, "workflow_failed", { reason });
    return next;
  }

  private finalize(workflow: Workflow): Workflow {
    const completed = workflow.taskRecords.filter(
      (r) => r.status === "completed",
    );
    const failed = workflow.taskRecords.filter(
      (r) =>
        r.status === "failed" ||
        r.status === "blocked" ||
        r.status === "skipped",
    );
    const allCompleted = completed.length === workflow.tasks.length;

    const taskResults: WorkflowTaskResultSummary[] = workflow.taskRecords.map(
      (r) => ({
        specId: r.specId,
        status: r.status,
        agentId: r.assignedAgentId,
        output: r.output,
        error: r.error,
      }),
    );

    if (allCompleted) {
      const result: WorkflowResult = {
        workflowId: workflow.id,
        status: "completed",
        summary: `${completed.length}/${workflow.tasks.length} tasks completed successfully.`,
        taskResults,
        completedAt: new Date(this.clock()).toISOString(),
        metadata: {},
      };
      workflow = this.workflows.setResult(workflow.id, result);
      const next = this.workflows.transition(workflow.id, "completed");
      this.emit(next, "workflow_completed", {
        completedTasks: completed.length,
      });
      return next;
    }

    if (failed.length > 0) {
      const result: WorkflowResult = {
        workflowId: workflow.id,
        status: "failed",
        summary: `${completed.length}/${workflow.tasks.length} completed; ${failed.length} failed or blocked.`,
        taskResults,
        completedAt: new Date(this.clock()).toISOString(),
        metadata: {},
      };
      workflow = this.workflows.setResult(workflow.id, result);
      return this.fail(
        workflow,
        `${failed.length} task(s) failed or were blocked`,
      );
    }

    return this.fail(workflow, "no tasks completed");
  }

  private emit(
    workflow: Workflow,
    kind: string,
    data: Record<string, unknown>,
  ): void {
    this.audit.record("workflow_event", {
      projectId: workflow.projectId,
      data: { kind, workflowId: workflow.id, ...data },
    });
  }
}
