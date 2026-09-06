import {
  type Agent,
  type Approval,
  type ApprovalPolicy,
  type Environment,
  type Handoff,
  type HandoffDraft,
  type PermissionAction,
  type RequiredPermission,
  type Task,
  type TaskDraft,
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  WorkforceError,
} from "../../contracts/index.js";
import { ApprovalSystem } from "../approvals/approval-system.js";
import { AuditLog } from "../audit/audit-log.js";
import { HandoffSystem } from "../handoffs/handoff-system.js";
import { PermissionSystem } from "../permissions/permission-system.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { TaskSystem } from "../tasks/task-system.js";

/**
 * Guard handed to an executor so tool-level calls can be permission-checked at
 * the moment of use, in addition to the pre-dispatch checks the orchestrator
 * performs. Bound to one agent + task + environment.
 */
export interface PermissionGuard {
  assert(action: PermissionAction, toolId?: string): void;
}

/** Pluggable unit of work. Phase 2A still ships only test doubles for this. */
export interface AgentExecutor {
  execute(agent: Agent, task: Task, guard?: PermissionGuard): Promise<unknown>;
}

export type AgentSelector = (candidates: readonly Agent[], task: Task) => Agent;

/** Deterministic default selection: lowest agent id among the candidates. */
export const selectFirstById: AgentSelector = (candidates) =>
  [...candidates].sort((a, b) => a.id.localeCompare(b.id))[0]!;

/** Default approval policy: nothing needs approval. */
export const approveNothing: ApprovalPolicy = {
  evaluate: () => ({ required: false }),
};

export interface OrchestratorOptions {
  selectAgent?: AgentSelector;
  approvalPolicy?: ApprovalPolicy;
  permissions?: PermissionSystem;
  environment?: Environment;
}

export type ResumeOutcome = "approved" | "rejected" | "expired";

/**
 * Minimal deterministic orchestrator.
 *
 * `submit` validates and queues a task, selects an eligible agent, enforces
 * permissions at the dispatch boundary, gates on human approval when the
 * approval policy requires it, and otherwise dispatches execution — recording
 * an audit event at every step. `resume` re-enters a task that was parked in
 * `awaiting_approval` once a human decision exists. No autonomous planning.
 */
export class Orchestrator {
  private readonly selectAgent: AgentSelector;
  private readonly approvalPolicy: ApprovalPolicy;
  private readonly permissions: PermissionSystem | undefined;
  private readonly environment: Environment;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly tasks: TaskSystem,
    private readonly handoffs: HandoffSystem,
    private readonly audit: AuditLog,
    private readonly executor: AgentExecutor,
    private readonly approvals: ApprovalSystem = new ApprovalSystem(),
    options: OrchestratorOptions = {},
  ) {
    this.selectAgent = options.selectAgent ?? selectFirstById;
    this.approvalPolicy = options.approvalPolicy ?? approveNothing;
    this.permissions = options.permissions;
    this.environment = options.environment ?? "local";
  }

  async submit(draft: TaskDraft): Promise<Task> {
    let task = this.tasks.create(draft);
    this.audit.record("task_created", {
      taskId: task.id,
      projectId: task.projectId,
      data: { type: task.type, priority: task.priority },
    });

    task = this.tasks.transition(task.id, "queued");

    const candidates = this.registry.eligible(task.type, task.projectId);
    if (candidates.length === 0) {
      task = this.tasks.transition(task.id, "blocked", {
        metadata: { blockedReason: "no eligible agent" },
      });
      this.audit.record("task_assigned", {
        taskId: task.id,
        projectId: task.projectId,
        data: { assigned: false, reason: "no eligible agent" },
      });
      return task;
    }

    const agent = this.selectAgent(candidates, task);
    task = this.tasks.assign(task.id, agent.id);
    this.audit.record("task_assigned", {
      taskId: task.id,
      agentId: agent.id,
      projectId: task.projectId,
      data: { assigned: true, candidates: candidates.map((a) => a.id) },
    });

    const denied = this.enforcePermissions(task, agent);
    if (denied) {
      return this.failTask(task, agent, denied.message, "permission_denied");
    }

    const requirement = this.approvalPolicy.evaluate(task);
    if (requirement.required) {
      const approval = this.approvals.request({
        action: requirement.action ?? task.type,
        requestedBy: `orchestrator:${agent.id}`,
        reason: requirement.reason ?? "approval policy requires a decision",
        expiresAt: requirement.expiresAt,
        metadata: { taskId: task.id },
      });
      this.audit.record("approval_requested", {
        taskId: task.id,
        agentId: agent.id,
        projectId: task.projectId,
        data: { approvalId: approval.id, action: approval.action },
      });
      return this.tasks.transition(task.id, "awaiting_approval", {
        approvalId: approval.id,
      });
    }

    return this.dispatch(task, agent);
  }

  /**
   * Record a human decision on the approval blocking a task. This is NOT
   * auto-approval — the caller supplies the decision.
   */
  recordApprovalDecision(
    approvalId: string,
    decision: "approved" | "rejected",
    decidedBy: string,
    metadata: Record<string, unknown> = {},
  ): Approval {
    const updated = this.approvals.decide(
      approvalId,
      decision,
      decidedBy,
      metadata,
    );
    const linkedTaskId =
      typeof updated.decisionMetadata.taskId === "string"
        ? updated.decisionMetadata.taskId
        : undefined;
    this.audit.record("approval_decided", {
      taskId: linkedTaskId,
      data: { approvalId, decision, decidedBy },
    });
    return updated;
  }

  /**
   * Re-enter a task parked in `awaiting_approval`. Requires an existing human
   * decision (or a lapsed expiry when `asOf` is provided).
   */
  async resume(taskId: string, options: { asOf?: string } = {}): Promise<Task> {
    let task = this.tasks.require(taskId);
    if (task.status !== "awaiting_approval") {
      throw new StateTransitionError(
        `task ${taskId} is not awaiting approval (status: ${task.status})`,
      );
    }
    if (!task.approvalId) {
      throw new WorkforceError(`task ${taskId} has no approval to resume from`);
    }
    if (options.asOf) {
      this.approvals.expireStale(options.asOf);
    }

    const approval = this.approvals.require(task.approvalId);
    if (approval.status === "requested") {
      throw new WorkforceError(
        `cannot resume task ${taskId}: approval ${approval.id} is still pending`,
      );
    }

    const outcome: ResumeOutcome =
      approval.status === "approved"
        ? "approved"
        : approval.status === "rejected"
          ? "rejected"
          : "expired";

    const agent = this.registry.require(task.assignedAgentId!);
    this.audit.record("task_resumed", {
      taskId: task.id,
      agentId: agent.id,
      projectId: task.projectId,
      data: { approvalId: approval.id, outcome },
    });

    if (outcome !== "approved") {
      const reason =
        outcome === "rejected" ? "approval rejected" : "approval expired";
      task = this.tasks.transition(task.id, "failed", { error: reason });
      this.audit.record("task_failed", {
        taskId: task.id,
        agentId: agent.id,
        projectId: task.projectId,
        data: { error: reason, reason: `approval_${outcome}` },
      });
      return task;
    }

    task = this.tasks.transition(task.id, "running");
    return this.dispatch(task, agent);
  }

  /** Validate and accept a handoff between two registered agents on a task. */
  requestHandoff(draft: HandoffDraft): Handoff {
    if (
      !this.registry.has(draft.sourceAgentId) ||
      !this.registry.has(draft.destinationAgentId)
    ) {
      throw new ValidationError("handoff agents must be registered");
    }
    if (!this.tasks.get(draft.taskId)) {
      throw new NotFoundError(`handoff task does not exist: ${draft.taskId}`);
    }

    const proposed = this.handoffs.propose(draft);
    const accepted = this.handoffs.accept(proposed.id);
    this.audit.record("handoff_created", {
      taskId: accepted.taskId,
      agentId: accepted.sourceAgentId,
      data: {
        handoffId: accepted.id,
        destinationAgentId: accepted.destinationAgentId,
      },
    });
    return accepted;
  }

  /* -------------------------------------------------------------- */
  /* internals                                                      */
  /* -------------------------------------------------------------- */

  private async dispatch(task: Task, agent: Agent): Promise<Task> {
    this.audit.record("agent_executed", {
      taskId: task.id,
      agentId: agent.id,
      projectId: task.projectId,
      data: {},
    });
    try {
      const output = await this.executor.execute(
        agent,
        task,
        this.makeGuard(task, agent),
      );
      const completed = this.tasks.complete(task.id, output);
      this.audit.record("task_completed", {
        taskId: completed.id,
        agentId: agent.id,
        projectId: completed.projectId,
        data: {},
      });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.tasks.fail(task.id, message);
      this.audit.record("task_failed", {
        taskId: failed.id,
        agentId: agent.id,
        projectId: failed.projectId,
        data: { error: message },
      });
      return failed;
    }
  }

  /**
   * Assert every declared required permission for the task at the dispatch
   * boundary. Returns a `PermissionDeniedError` on the first denial, or
   * `undefined` if all checks pass. Each check is audited.
   */
  private enforcePermissions(
    task: Task,
    agent: Agent,
  ): PermissionDeniedError | undefined {
    if (task.requiredPermissions.length === 0) return undefined;

    if (!this.permissions) {
      return new PermissionDeniedError(
        `permission denied: no permission system configured for gated task ${task.id}`,
      );
    }

    for (const required of task.requiredPermissions) {
      const request = this.toPermissionRequest(task, agent, required);
      const decision = this.permissions.evaluate(request);
      this.audit.record("permission_decision", {
        taskId: task.id,
        agentId: agent.id,
        projectId: task.projectId,
        data: {
          action: required.action,
          toolId: required.toolId,
          environment: this.environment,
          allowed: decision.allowed,
          reason: decision.reason,
        },
      });
      if (!decision.allowed) {
        const tool = required.toolId ? `/${required.toolId}` : "";
        return new PermissionDeniedError(
          `permission denied: ${agent.id} ${required.action} on ` +
            `${task.projectId}${tool} (${this.environment}) — ${decision.reason}`,
        );
      }
    }
    return undefined;
  }

  private makeGuard(task: Task, agent: Agent): PermissionGuard {
    const permissions = this.permissions;
    const environment = this.environment;
    return {
      assert(action: PermissionAction, toolId?: string): void {
        if (!permissions) return;
        permissions.assert({
          action,
          toolId,
          agentId: agent.id,
          projectId: task.projectId,
          environment,
        });
      },
    };
  }

  private toPermissionRequest(
    task: Task,
    agent: Agent,
    required: RequiredPermission,
  ) {
    return {
      action: required.action,
      toolId: required.toolId,
      agentId: agent.id,
      projectId: task.projectId,
      environment: this.environment,
    };
  }

  private failTask(
    task: Task,
    agent: Agent,
    message: string,
    reason: string,
  ): Task {
    const failed = this.tasks.fail(task.id, message);
    this.audit.record("task_failed", {
      taskId: failed.id,
      agentId: agent.id,
      projectId: failed.projectId,
      data: { error: message, reason },
    });
    return failed;
  }
}
