/**
 * WorkforceCommandService — the write side of the Control Plane.
 *
 * Every command runs the same pipeline:
 *   1. validate input             (shape)
 *   2. validate authorization     (role capability + project scope)
 *   3. validate current state     (resource exists & is in a valid state)
 *   4. execute through core       (ApprovalSystem / Orchestrator / TaskSystem /
 *                                  WorkflowSystem / WorkflowEngine / stores)
 *   5. create audit event         (`control_command`, ALWAYS — including denied)
 *   6. return a structured result
 *
 * The UI never mutates state directly; it calls these methods.
 */
import {
  type AgentCommandInput,
  type ApprovalCommandInput,
  type ControlCommand,
  type ControlCommandOutcome,
  type ControlCommandResult,
  type OperatorPrincipal,
  type RejectCommandInput,
  type TaskCommandInput,
  type WorkflowCommandInput,
  DEFAULT_RETRY_POLICY,
  operatorCan,
  operatorCanAccessProject,
  requireId,
  validateOperatorPrincipal,
} from "../../contracts/index.js";
import { extractFailureReason, now } from "../../core/index.js";
import { type ControlPlaneContext } from "../context.js";
import { redact } from "../redaction.js";

const TERMINAL_TASK_STATUSES = new Set(["completed", "cancelled"]);
const TERMINAL_WORKFLOW_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export class WorkforceCommandService {
  private readonly maxRetries: number;

  constructor(private readonly ctx: ControlPlaneContext) {
    this.maxRetries = ctx.maxOperatorRetries ?? 3;
  }

  /* -------------------------------------------------------------- */
  /* approvals                                                     */
  /* -------------------------------------------------------------- */

  async approve(
    principal: OperatorPrincipal,
    input: ApprovalCommandInput,
  ): Promise<ControlCommandResult> {
    return this.decideApproval(principal, "approve", input.approvalId, {
      decision: "approved",
      note: input.note,
    });
  }

  async reject(
    principal: OperatorPrincipal,
    input: RejectCommandInput,
  ): Promise<ControlCommandResult> {
    try {
      requireId(input?.reason, "reject.reason");
    } catch (error) {
      return this.audited(
        principal,
        "reject",
        "rejected",
        input?.approvalId,
        error instanceof Error ? error.message : String(error),
        {},
      );
    }
    return this.decideApproval(principal, "reject", input.approvalId, {
      decision: "rejected",
      note: input.reason,
    });
  }

  private async decideApproval(
    principal: OperatorPrincipal,
    command: "approve" | "reject",
    approvalIdRaw: string,
    opts: { decision: "approved" | "rejected"; note?: string },
  ): Promise<ControlCommandResult> {
    let approvalId: string;
    try {
      approvalId = requireId(approvalIdRaw, `${command}.approvalId`);
    } catch (error) {
      return this.audited(
        principal,
        command,
        "rejected",
        undefined,
        error instanceof Error ? error.message : String(error),
        {},
      );
    }

    const capability = command === "approve" ? "approve" : "reject";
    if (!operatorCan(principal, capability)) {
      return this.audited(
        principal,
        command,
        "denied",
        approvalId,
        `role "${principal.role}" may not ${command}`,
        {},
      );
    }

    const approval = this.ctx.approvals.get(approvalId);
    if (!approval) {
      return this.audited(
        principal,
        command,
        "rejected",
        approvalId,
        "unknown approval",
        {},
      );
    }
    if (approval.status !== "requested") {
      return this.audited(
        principal,
        command,
        "rejected",
        approvalId,
        `approval is already ${approval.status}`,
        {},
      );
    }

    const meta = approval.decisionMetadata ?? {};
    const taskId = typeof meta.taskId === "string" ? meta.taskId : undefined;
    const linkedTask = taskId ? this.ctx.tasks.get(taskId) : undefined;
    const projectId = linkedTask?.projectId;
    if (projectId && !operatorCanAccessProject(principal, projectId)) {
      return this.audited(
        principal,
        command,
        "denied",
        approvalId,
        `operator may not act on project "${projectId}"`,
        { projectId },
      );
    }

    // 4. execute through core
    const enacted: Record<string, unknown> = {};
    if (taskId && this.ctx.orchestrator) {
      this.ctx.orchestrator.recordApprovalDecision(
        approvalId,
        opts.decision,
        principal.id,
        { via: "control-plane", note: opts.note },
      );
      if (opts.decision === "approved") {
        try {
          const task = await this.ctx.orchestrator.resume(taskId);
          enacted.taskResumed = true;
          enacted.taskStatus = task.status;
        } catch (error) {
          enacted.taskResumeError =
            error instanceof Error ? error.message : String(error);
        }
      }
    } else {
      this.ctx.approvals.decide(approvalId, opts.decision, principal.id, {
        via: "control-plane",
        note: opts.note,
      });
    }

    // best-effort workflow continuation
    const workflowId =
      typeof meta.workflowId === "string"
        ? meta.workflowId
        : linkedTask?.metadata.workflowId;
    if (
      opts.decision === "approved" &&
      typeof workflowId === "string" &&
      this.ctx.workflowEngine
    ) {
      const workflow = this.ctx.workflows.get(workflowId);
      if (workflow?.status === "awaiting_approval") {
        try {
          const resumed = await this.ctx.workflowEngine.resume(workflowId);
          enacted.workflowResumed = true;
          enacted.workflowStatus = resumed.status;
        } catch (error) {
          enacted.workflowResumeError =
            error instanceof Error ? error.message : String(error);
        }
      }
    }

    return this.audited(
      principal,
      command,
      "executed",
      approvalId,
      `approval ${opts.decision}`,
      { decision: opts.decision, taskId, workflowId, ...enacted },
    );
  }

  /* -------------------------------------------------------------- */
  /* tasks                                                         */
  /* -------------------------------------------------------------- */

  async cancelTask(
    principal: OperatorPrincipal,
    input: TaskCommandInput,
  ): Promise<ControlCommandResult> {
    const check = this.resolveTask(principal, "cancel_task", input?.taskId);
    if (!check.ok) return check.result;
    const task = check.task;

    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      return this.audited(
        principal,
        "cancel_task",
        "rejected",
        task.id,
        `task is already ${task.status}`,
        { projectId: task.projectId },
      );
    }
    if (!this.ctx.tasks.canTransition(task.status, "cancelled")) {
      return this.audited(
        principal,
        "cancel_task",
        "rejected",
        task.id,
        `cannot cancel a task in status ${task.status}`,
        { projectId: task.projectId },
      );
    }

    const next = this.ctx.tasks.transition(task.id, "cancelled", {
      error: input.reason
        ? `cancelled by operator ${principal.id}: ${input.reason}`
        : `cancelled by operator ${principal.id}`,
      metadata: { cancelledBy: principal.id },
    });
    return this.audited(
      principal,
      "cancel_task",
      "executed",
      task.id,
      "task cancelled",
      { projectId: task.projectId, status: next.status },
    );
  }

  async retryTask(
    principal: OperatorPrincipal,
    input: TaskCommandInput,
  ): Promise<ControlCommandResult> {
    const check = this.resolveTask(principal, "retry_task", input?.taskId);
    if (!check.ok) return check.result;
    const task = check.task;

    if (task.status !== "failed") {
      return this.audited(
        principal,
        "retry_task",
        "rejected",
        task.id,
        `only a failed task may be retried (status: ${task.status})`,
        { projectId: task.projectId },
      );
    }
    if (typeof task.metadata.workflowId === "string") {
      return this.audited(
        principal,
        "retry_task",
        "rejected",
        task.id,
        "this task belongs to a workflow — retry it via the workflow, not directly",
        { projectId: task.projectId, workflowId: task.metadata.workflowId },
      );
    }

    const lastError = task.errors.at(-1) ?? "";
    const reason = extractFailureReason(lastError);
    if (reason && !DEFAULT_RETRY_POLICY.retryableReasons.includes(reason)) {
      return this.audited(
        principal,
        "retry_task",
        "rejected",
        task.id,
        `failure reason "${reason}" is not retryable`,
        { projectId: task.projectId, reason },
      );
    }

    const already =
      typeof task.metadata.controlRetryCount === "number"
        ? task.metadata.controlRetryCount
        : 0;
    if (already >= this.maxRetries) {
      return this.audited(
        principal,
        "retry_task",
        "rejected",
        task.id,
        `retry limit reached (${already}/${this.maxRetries})`,
        { projectId: task.projectId },
      );
    }

    const next = this.ctx.tasks.transition(task.id, "queued", {
      metadata: {
        controlRetryCount: already + 1,
        retriedBy: principal.id,
      },
    });
    return this.audited(
      principal,
      "retry_task",
      "executed",
      task.id,
      `task re-queued (attempt ${already + 1})`,
      { projectId: task.projectId, status: next.status, attempt: already + 1 },
    );
  }

  /* -------------------------------------------------------------- */
  /* workflows                                                     */
  /* -------------------------------------------------------------- */

  async pauseWorkflow(
    principal: OperatorPrincipal,
    input: WorkflowCommandInput,
  ): Promise<ControlCommandResult> {
    const check = this.resolveWorkflow(
      principal,
      "pause_workflow",
      input?.workflowId,
    );
    if (!check.ok) return check.result;
    const workflow = check.workflow;

    if (TERMINAL_WORKFLOW_STATUSES.has(workflow.status)) {
      return this.audited(
        principal,
        "pause_workflow",
        "rejected",
        workflow.id,
        `workflow is already ${workflow.status}`,
        { projectId: workflow.projectId },
      );
    }
    if (this.ctx.workflowControl.isPaused(workflow.id)) {
      return this.audited(
        principal,
        "pause_workflow",
        "rejected",
        workflow.id,
        "workflow is already paused",
        { projectId: workflow.projectId },
      );
    }

    this.ctx.workflowControl.pause(workflow.id, principal.id, input.reason);
    return this.audited(
      principal,
      "pause_workflow",
      "executed",
      workflow.id,
      "workflow paused — no further task dispatch until resumed",
      { projectId: workflow.projectId, reason: input.reason },
    );
  }

  async resumeWorkflow(
    principal: OperatorPrincipal,
    input: WorkflowCommandInput,
  ): Promise<ControlCommandResult> {
    const check = this.resolveWorkflow(
      principal,
      "resume_workflow",
      input?.workflowId,
    );
    if (!check.ok) return check.result;
    const workflow = check.workflow;

    if (TERMINAL_WORKFLOW_STATUSES.has(workflow.status)) {
      return this.audited(
        principal,
        "resume_workflow",
        "rejected",
        workflow.id,
        `workflow is already ${workflow.status}`,
        { projectId: workflow.projectId },
      );
    }

    const wasPaused = this.ctx.workflowControl.isPaused(workflow.id);
    if (wasPaused) {
      this.ctx.workflowControl.resume(workflow.id, principal.id);
    }

    const enacted: Record<string, unknown> = { unpaused: wasPaused };
    if (workflow.status === "awaiting_approval" && this.ctx.workflowEngine) {
      try {
        const next = await this.ctx.workflowEngine.resume(workflow.id);
        enacted.engineResumed = true;
        enacted.workflowStatus = next.status;
      } catch (error) {
        enacted.engineResumeError =
          error instanceof Error ? error.message : String(error);
      }
    }

    if (!wasPaused && !enacted.engineResumed) {
      return this.audited(
        principal,
        "resume_workflow",
        "rejected",
        workflow.id,
        `nothing to resume (status: ${workflow.status}, not paused)`,
        { projectId: workflow.projectId },
      );
    }

    return this.audited(
      principal,
      "resume_workflow",
      "executed",
      workflow.id,
      "workflow resumed",
      { projectId: workflow.projectId, ...enacted },
    );
  }

  async cancelWorkflow(
    principal: OperatorPrincipal,
    input: WorkflowCommandInput,
  ): Promise<ControlCommandResult> {
    const check = this.resolveWorkflow(
      principal,
      "cancel_workflow",
      input?.workflowId,
    );
    if (!check.ok) return check.result;
    const workflow = check.workflow;

    if (TERMINAL_WORKFLOW_STATUSES.has(workflow.status)) {
      return this.audited(
        principal,
        "cancel_workflow",
        "rejected",
        workflow.id,
        `workflow is already ${workflow.status}`,
        { projectId: workflow.projectId },
      );
    }
    if (!this.ctx.workflows.canTransition(workflow.status, "cancelled")) {
      return this.audited(
        principal,
        "cancel_workflow",
        "rejected",
        workflow.id,
        `cannot cancel a workflow in status ${workflow.status}`,
        { projectId: workflow.projectId },
      );
    }

    const next = this.ctx.workflows.transition(workflow.id, "cancelled", {
      error: input.reason
        ? `cancelled by operator ${principal.id}: ${input.reason}`
        : `cancelled by operator ${principal.id}`,
      metadata: { cancelledBy: principal.id },
    });
    return this.audited(
      principal,
      "cancel_workflow",
      "executed",
      workflow.id,
      "workflow cancelled",
      { projectId: workflow.projectId, status: next.status },
    );
  }

  /* -------------------------------------------------------------- */
  /* agents                                                        */
  /* -------------------------------------------------------------- */

  async disableAgent(
    principal: OperatorPrincipal,
    input: AgentCommandInput,
  ): Promise<ControlCommandResult> {
    return this.setAgentEnabled(principal, "disable_agent", input, false);
  }

  async enableAgent(
    principal: OperatorPrincipal,
    input: AgentCommandInput,
  ): Promise<ControlCommandResult> {
    return this.setAgentEnabled(principal, "enable_agent", input, true);
  }

  private async setAgentEnabled(
    principal: OperatorPrincipal,
    command: "disable_agent" | "enable_agent",
    input: AgentCommandInput,
    enabled: boolean,
  ): Promise<ControlCommandResult> {
    let agentId: string;
    try {
      agentId = requireId(input?.agentId, `${command}.agentId`);
    } catch (error) {
      return this.audited(
        principal,
        command,
        "rejected",
        undefined,
        error instanceof Error ? error.message : String(error),
        {},
      );
    }

    if (!operatorCan(principal, command)) {
      return this.audited(
        principal,
        command,
        "denied",
        agentId,
        `role "${principal.role}" may not ${command.replace("_", " ")}`,
        {},
      );
    }

    if (!this.ctx.agents.has(agentId)) {
      return this.audited(
        principal,
        command,
        "rejected",
        agentId,
        "unknown agent",
        {},
      );
    }

    const currentlyEnabled = this.ctx.agentOps.isEnabled(agentId);
    if (currentlyEnabled === enabled) {
      return this.audited(
        principal,
        command,
        "rejected",
        agentId,
        `agent is already ${enabled ? "enabled" : "disabled"}`,
        {},
      );
    }

    if (enabled) {
      this.ctx.agentOps.enable(agentId, principal.id);
    } else {
      this.ctx.agentOps.disable(
        agentId,
        principal.id,
        input.reason ?? "disabled by operator",
      );
    }

    return this.audited(
      principal,
      command,
      "executed",
      agentId,
      enabled
        ? "agent enabled — may receive new tasks again"
        : "agent disabled — will not receive new tasks; running work is left to finish",
      { reason: input.reason },
    );
  }

  /* -------------------------------------------------------------- */
  /* shared plumbing                                               */
  /* -------------------------------------------------------------- */

  private resolveTask(
    principal: OperatorPrincipal,
    command: ControlCommand,
    taskIdRaw: string | undefined,
  ):
    | { ok: true; task: import("../../contracts/index.js").Task }
    | { ok: false; result: ControlCommandResult } {
    let taskId: string;
    try {
      taskId = requireId(taskIdRaw, `${command}.taskId`);
    } catch (error) {
      return {
        ok: false,
        result: this.audited(
          principal,
          command,
          "rejected",
          undefined,
          error instanceof Error ? error.message : String(error),
          {},
        ),
      };
    }
    const capability = command === "retry_task" ? "retry_task" : "cancel_task";
    if (!operatorCan(principal, capability)) {
      return {
        ok: false,
        result: this.audited(
          principal,
          command,
          "denied",
          taskId,
          `role "${principal.role}" may not ${command.replace("_", " ")}`,
          {},
        ),
      };
    }
    const task = this.ctx.tasks.get(taskId);
    if (!task) {
      return {
        ok: false,
        result: this.audited(
          principal,
          command,
          "rejected",
          taskId,
          "unknown task",
          {},
        ),
      };
    }
    if (!operatorCanAccessProject(principal, task.projectId)) {
      return {
        ok: false,
        result: this.audited(
          principal,
          command,
          "denied",
          taskId,
          `operator may not act on project "${task.projectId}"`,
          { projectId: task.projectId },
        ),
      };
    }
    return { ok: true, task };
  }

  private resolveWorkflow(
    principal: OperatorPrincipal,
    command: ControlCommand,
    workflowIdRaw: string | undefined,
  ):
    | { ok: true; workflow: import("../../contracts/index.js").Workflow }
    | { ok: false; result: ControlCommandResult } {
    let workflowId: string;
    try {
      workflowId = requireId(workflowIdRaw, `${command}.workflowId`);
    } catch (error) {
      return {
        ok: false,
        result: this.audited(
          principal,
          command,
          "rejected",
          undefined,
          error instanceof Error ? error.message : String(error),
          {},
        ),
      };
    }
    if (
      !operatorCan(
        principal,
        command as "pause_workflow" | "resume_workflow" | "cancel_workflow",
      )
    ) {
      return {
        ok: false,
        result: this.audited(
          principal,
          command,
          "denied",
          workflowId,
          `role "${principal.role}" may not ${command.replace("_", " ")}`,
          {},
        ),
      };
    }
    const workflow = this.ctx.workflows.get(workflowId);
    if (!workflow) {
      return {
        ok: false,
        result: this.audited(
          principal,
          command,
          "rejected",
          workflowId,
          "unknown workflow",
          {},
        ),
      };
    }
    if (!operatorCanAccessProject(principal, workflow.projectId)) {
      return {
        ok: false,
        result: this.audited(
          principal,
          command,
          "denied",
          workflowId,
          `operator may not act on project "${workflow.projectId}"`,
          { projectId: workflow.projectId },
        ),
      };
    }
    return { ok: true, workflow };
  }

  /** Record a `control_command` audit event and return the structured result. */
  private audited(
    principal: OperatorPrincipal,
    command: ControlCommand,
    outcome: ControlCommandOutcome,
    resourceId: string | undefined,
    reason: string,
    details: Record<string, unknown>,
  ): ControlCommandResult {
    // Validate the principal shape even on the failure paths.
    try {
      validateOperatorPrincipal(principal);
    } catch {
      /* fall through — the event still records what was attempted */
    }
    const projectId =
      typeof details.projectId === "string" ? details.projectId : undefined;
    const event = this.ctx.audit.record("control_command", {
      projectId,
      agentId: command.endsWith("_agent") ? resourceId : undefined,
      taskId: command.endsWith("_task") ? resourceId : undefined,
      data: {
        command,
        outcome,
        actor: principal?.id ?? "unknown",
        actorRole: principal?.role ?? "unknown",
        resourceId,
        reason,
        ...redact(details),
      },
    });
    return {
      command,
      outcome,
      ok: outcome === "executed",
      reason,
      resourceId,
      details: redact(details),
      auditEventId: event.id,
      timestamp: now(),
    };
  }
}
