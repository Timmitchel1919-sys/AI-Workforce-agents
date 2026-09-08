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
 * The UI never mutates state directly; it calls these methods. Every call
 * carries a correlation id (supplied by the caller or minted here) that is
 * written to the audit event and returned on the result, so a control request
 * can be traced through the command, the core operation, and the audit log.
 */
import {
  type AgentCommandInput,
  type ApprovalCommandInput,
  type CommandOptions,
  type ControlCommand,
  type ControlCommandOutcome,
  type ControlCommandResult,
  type ControlErrorKind,
  type OperatorPrincipal,
  type RejectCommandInput,
  type Task,
  type TaskCommandInput,
  type Workflow,
  type WorkflowCommandInput,
  DEFAULT_RETRY_POLICY,
  operatorCan,
  operatorCanAccessProject,
  requireId,
  validateOperatorPrincipal,
} from "../../contracts/index.js";
import { extractFailureReason, now } from "../../core/index.js";
import { type ControlPlaneContext } from "../context.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";

/** Carries the per-request correlation id through a command's helpers. */
interface CommandRun {
  readonly correlationId: string;
}

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
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const run: CommandRun = { correlationId: resolveCorrelationId(options) };
    return this.decideApproval(principal, "approve", input?.approvalId, run, {
      decision: "approved",
      note: input?.note,
    });
  }

  async reject(
    principal: OperatorPrincipal,
    input: RejectCommandInput,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const run: CommandRun = { correlationId: resolveCorrelationId(options) };
    try {
      requireId(input?.reason, "reject.reason");
    } catch (error) {
      return this.audited(
        principal,
        "reject",
        "rejected",
        input?.approvalId,
        message(error),
        {},
        run,
      );
    }
    return this.decideApproval(principal, "reject", input.approvalId, run, {
      decision: "rejected",
      note: input.reason,
    });
  }

  private async decideApproval(
    principal: OperatorPrincipal,
    command: "approve" | "reject",
    approvalIdRaw: string | undefined,
    run: CommandRun,
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
        message(error),
        {},
        run,
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
        run,
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
        run,
        "not_found",
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
        run,
        "invalid_state",
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
        run,
      );
    }

    // 4. execute the decision through core. A failure here is a real
    //    approval-subsystem fault — surfaced as `approval_failure`, never a
    //    leaked stack trace.
    const enacted: Record<string, unknown> = {};
    try {
      if (taskId && this.ctx.orchestrator) {
        this.ctx.orchestrator.recordApprovalDecision(
          approvalId,
          opts.decision,
          principal.id,
          { via: "control-plane", note: opts.note },
        );
      } else {
        this.ctx.approvals.decide(approvalId, opts.decision, principal.id, {
          via: "control-plane",
          note: opts.note,
        });
      }
    } catch (error) {
      return this.audited(
        principal,
        command,
        "rejected",
        approvalId,
        `could not record the decision: ${message(error)}`,
        { projectId },
        run,
        "approval_failure",
      );
    }

    // Enacting the follow-up (task / workflow resume) is best effort — the
    // decision is already recorded.
    if (taskId && this.ctx.orchestrator && opts.decision === "approved") {
      try {
        const task = await this.ctx.orchestrator.resume(taskId);
        enacted.taskResumed = true;
        enacted.taskStatus = task.status;
      } catch (error) {
        enacted.taskResumeError = message(error);
      }
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
          enacted.workflowResumeError = message(error);
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
      run,
    );
  }

  /* -------------------------------------------------------------- */
  /* tasks                                                         */
  /* -------------------------------------------------------------- */

  async cancelTask(
    principal: OperatorPrincipal,
    input: TaskCommandInput,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const run: CommandRun = { correlationId: resolveCorrelationId(options) };
    const check = this.resolveTask(
      principal,
      "cancel_task",
      input?.taskId,
      run,
    );
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
        run,
        "invalid_state",
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
        run,
        "invalid_state",
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
      run,
    );
  }

  async retryTask(
    principal: OperatorPrincipal,
    input: TaskCommandInput,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const run: CommandRun = { correlationId: resolveCorrelationId(options) };
    const check = this.resolveTask(principal, "retry_task", input?.taskId, run);
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
        run,
        "invalid_state",
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
        run,
        "invalid_state",
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
        run,
        "invalid_state",
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
        run,
        "invalid_state",
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
      run,
    );
  }

  /* -------------------------------------------------------------- */
  /* workflows                                                     */
  /* -------------------------------------------------------------- */

  async pauseWorkflow(
    principal: OperatorPrincipal,
    input: WorkflowCommandInput,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const run: CommandRun = { correlationId: resolveCorrelationId(options) };
    const check = this.resolveWorkflow(
      principal,
      "pause_workflow",
      input?.workflowId,
      run,
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
        run,
        "invalid_state",
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
        run,
        "invalid_state",
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
      run,
    );
  }

  async resumeWorkflow(
    principal: OperatorPrincipal,
    input: WorkflowCommandInput,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const run: CommandRun = { correlationId: resolveCorrelationId(options) };
    const check = this.resolveWorkflow(
      principal,
      "resume_workflow",
      input?.workflowId,
      run,
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
        run,
        "invalid_state",
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
        enacted.engineResumeError = message(error);
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
        run,
        "invalid_state",
      );
    }

    return this.audited(
      principal,
      "resume_workflow",
      "executed",
      workflow.id,
      "workflow resumed",
      { projectId: workflow.projectId, ...enacted },
      run,
    );
  }

  async cancelWorkflow(
    principal: OperatorPrincipal,
    input: WorkflowCommandInput,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const run: CommandRun = { correlationId: resolveCorrelationId(options) };
    const check = this.resolveWorkflow(
      principal,
      "cancel_workflow",
      input?.workflowId,
      run,
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
        run,
        "invalid_state",
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
        run,
        "invalid_state",
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
      run,
    );
  }

  /* -------------------------------------------------------------- */
  /* agents                                                        */
  /* -------------------------------------------------------------- */

  async disableAgent(
    principal: OperatorPrincipal,
    input: AgentCommandInput,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const run: CommandRun = { correlationId: resolveCorrelationId(options) };
    return this.setAgentEnabled(principal, "disable_agent", input, false, run);
  }

  async enableAgent(
    principal: OperatorPrincipal,
    input: AgentCommandInput,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const run: CommandRun = { correlationId: resolveCorrelationId(options) };
    return this.setAgentEnabled(principal, "enable_agent", input, true, run);
  }

  private async setAgentEnabled(
    principal: OperatorPrincipal,
    command: "disable_agent" | "enable_agent",
    input: AgentCommandInput,
    enabled: boolean,
    run: CommandRun,
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
        message(error),
        {},
        run,
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
        run,
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
        run,
        "not_found",
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
        run,
        "invalid_state",
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
      run,
    );
  }

  /* -------------------------------------------------------------- */
  /* shared plumbing                                               */
  /* -------------------------------------------------------------- */

  private resolveTask(
    principal: OperatorPrincipal,
    command: ControlCommand,
    taskIdRaw: string | undefined,
    run: CommandRun,
  ): { ok: true; task: Task } | { ok: false; result: ControlCommandResult } {
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
          message(error),
          {},
          run,
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
          run,
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
          run,
          "not_found",
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
          run,
        ),
      };
    }
    return { ok: true, task };
  }

  private resolveWorkflow(
    principal: OperatorPrincipal,
    command: ControlCommand,
    workflowIdRaw: string | undefined,
    run: CommandRun,
  ):
    | { ok: true; workflow: Workflow }
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
          message(error),
          {},
          run,
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
          run,
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
          run,
          "not_found",
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
          run,
        ),
      };
    }
    return { ok: true, workflow };
  }

  /**
   * Record a `control_command` audit event and return the structured result.
   * `errorKind` refines a non-`executed` outcome; when omitted it defaults to
   * `forbidden` for a denial and `invalid_request` for a rejection.
   */
  private audited(
    principal: OperatorPrincipal,
    command: ControlCommand,
    outcome: ControlCommandOutcome,
    resourceId: string | undefined,
    reason: string,
    details: Record<string, unknown>,
    run: CommandRun,
    errorKind?: ControlErrorKind,
  ): ControlCommandResult {
    // Validate the principal shape even on the failure paths.
    try {
      validateOperatorPrincipal(principal);
    } catch {
      /* fall through — the event still records what was attempted */
    }
    const kind: ControlErrorKind | undefined =
      outcome === "executed"
        ? undefined
        : (errorKind ??
          (outcome === "denied" ? "forbidden" : "invalid_request"));
    const projectId =
      typeof details.projectId === "string" ? details.projectId : undefined;
    const event = this.ctx.audit.record("control_command", {
      projectId,
      agentId: command.endsWith("_agent") ? resourceId : undefined,
      taskId: command.endsWith("_task") ? resourceId : undefined,
      data: {
        command,
        outcome,
        errorKind: kind,
        correlationId: run.correlationId,
        actor: principal?.id ?? "unknown",
        actorRole: principal?.role ?? "unknown",
        resourceId,
        reason,
        ...redact(details),
      },
    });
    const result: ControlCommandResult = {
      command,
      outcome,
      ok: outcome === "executed",
      errorKind: kind,
      reason,
      resourceId,
      correlationId: run.correlationId,
      details: redact(details),
      auditEventId: event.id,
      timestamp: now(),
    };
    this.publish(result);
    return result;
  }

  /** Best-effort real-time fan-out. A throwing publisher never breaks a command. */
  private publish(result: ControlCommandResult): void {
    if (!this.ctx.events) return;
    try {
      this.ctx.events.publish({ kind: "command_result", result });
    } catch {
      /* the command already succeeded/failed on its own terms */
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
