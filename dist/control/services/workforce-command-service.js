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
import { DEFAULT_RETRY_POLICY, NotFoundError, StateTransitionError, ValidationError, operatorCan, operatorCanAccessProject, requireId, validateOperatorPrincipal, } from "../../contracts/index.js";
import { extractFailureReason, now, } from "../../core/index.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";
const TERMINAL_TASK_STATUSES = new Set(["completed", "cancelled"]);
const TERMINAL_WORKFLOW_STATUSES = new Set([
    "completed",
    "failed",
    "cancelled",
]);
export class WorkforceCommandService {
    ctx;
    maxRetries;
    constructor(ctx) {
        this.ctx = ctx;
        this.maxRetries = ctx.maxOperatorRetries ?? 3;
    }
    /* -------------------------------------------------------------- */
    /* approvals                                                     */
    /* -------------------------------------------------------------- */
    async approve(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        return this.decideApproval(principal, "approve", input?.approvalId, run, {
            decision: "approved",
            note: input?.note,
        });
    }
    async reject(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        try {
            requireId(input?.reason, "reject.reason");
        }
        catch (error) {
            return this.audited(principal, "reject", "rejected", input?.approvalId, message(error), {}, run);
        }
        return this.decideApproval(principal, "reject", input.approvalId, run, {
            decision: "rejected",
            note: input.reason,
        });
    }
    async decideApproval(principal, command, approvalIdRaw, run, opts) {
        let approvalId;
        try {
            approvalId = requireId(approvalIdRaw, `${command}.approvalId`);
        }
        catch (error) {
            return this.audited(principal, command, "rejected", undefined, message(error), {}, run);
        }
        const capability = command === "approve" ? "approve" : "reject";
        if (!operatorCan(principal, capability)) {
            return this.audited(principal, command, "denied", approvalId, `role "${principal.role}" may not ${command}`, {}, run);
        }
        const approval = this.ctx.approvals.get(approvalId);
        if (!approval) {
            return this.audited(principal, command, "rejected", approvalId, "unknown approval", {}, run, "not_found");
        }
        if (approval.status !== "requested") {
            return this.audited(principal, command, "rejected", approvalId, `approval is already ${approval.status}`, {}, run, "invalid_state");
        }
        const meta = approval.decisionMetadata ?? {};
        const taskId = typeof meta.taskId === "string" ? meta.taskId : undefined;
        const linkedTask = taskId ? this.ctx.tasks.get(taskId) : undefined;
        const planDocId = typeof meta.executionPlanId === "string"
            ? meta.executionPlanId
            : undefined;
        const linkedPlan = planDocId
            ? this.ctx.planning?.get(planDocId)
            : undefined;
        const projectId = linkedTask?.projectId ?? linkedPlan?.projectId;
        if (projectId && !operatorCanAccessProject(principal, projectId)) {
            return this.audited(principal, command, "denied", approvalId, `operator may not act on project "${projectId}"`, { projectId }, run);
        }
        // 4. execute the decision through core. A failure here is a real
        //    approval-subsystem fault — surfaced as `approval_failure`, never a
        //    leaked stack trace.
        const enacted = {};
        try {
            if (taskId && this.ctx.orchestrator) {
                this.ctx.orchestrator.recordApprovalDecision(approvalId, opts.decision, principal.id, { via: "control-plane", note: opts.note });
            }
            else {
                this.ctx.approvals.decide(approvalId, opts.decision, principal.id, {
                    via: "control-plane",
                    note: opts.note,
                });
            }
        }
        catch (error) {
            return this.audited(principal, command, "rejected", approvalId, `could not record the decision: ${message(error)}`, { projectId }, run, "approval_failure");
        }
        // Enacting the follow-up (task / workflow resume) is best effort — the
        // decision is already recorded.
        if (taskId && this.ctx.orchestrator && opts.decision === "approved") {
            try {
                const task = await this.ctx.orchestrator.resume(taskId);
                enacted.taskResumed = true;
                enacted.taskStatus = task.status;
            }
            catch (error) {
                enacted.taskResumeError = message(error);
            }
        }
        // Mirror the decision onto an execution plan. Approval changes planning
        // governance state only — nothing is executed.
        if (linkedPlan && this.ctx.planning) {
            try {
                const decided = this.ctx.approvals.get(approvalId);
                const updated = decided
                    ? this.ctx.planning.applyApprovalDecision(decided, {
                        id: principal.id,
                        correlationId: run.correlationId,
                    })
                    : undefined;
                enacted.executionPlanId = linkedPlan.id;
                enacted.executionPlanStatus = updated?.status ?? linkedPlan.status;
            }
            catch (error) {
                enacted.executionPlanError = message(error);
            }
        }
        // best-effort workflow continuation
        const workflowId = typeof meta.workflowId === "string"
            ? meta.workflowId
            : linkedTask?.metadata.workflowId;
        if (opts.decision === "approved" &&
            typeof workflowId === "string" &&
            this.ctx.workflowEngine) {
            const workflow = this.ctx.workflows.get(workflowId);
            if (workflow?.status === "awaiting_approval") {
                try {
                    const resumed = await this.ctx.workflowEngine.resume(workflowId);
                    enacted.workflowResumed = true;
                    enacted.workflowStatus = resumed.status;
                }
                catch (error) {
                    enacted.workflowResumeError = message(error);
                }
            }
        }
        return this.audited(principal, command, "executed", approvalId, `approval ${opts.decision}`, { decision: opts.decision, taskId, workflowId, ...enacted }, run);
    }
    /* -------------------------------------------------------------- */
    /* execution plans (EO-3.1) — planning only, never execution     */
    /* -------------------------------------------------------------- */
    /**
     * Create an execution plan from a planning request. The server derives
     * environments, agents, blockers and status; client-supplied values for
     * any of those are ignored.
     */
    async createExecutionPlan(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        const command = "create_execution_plan";
        let projectId;
        try {
            projectId = requireId(input?.projectId, "request.projectId");
        }
        catch (error) {
            return this.audited(principal, command, "rejected", undefined, message(error), {}, run);
        }
        if (!operatorCan(principal, command)) {
            return this.audited(principal, command, "denied", undefined, `role "${principal.role}" may not create execution plans`, { projectId }, run);
        }
        const planning = this.ctx.planning;
        if (!planning) {
            return this.audited(principal, command, "rejected", undefined, "execution planning is not configured", { projectId }, run, "invalid_state");
        }
        if (!this.ctx.projects.has(projectId)) {
            return this.audited(principal, command, "rejected", undefined, "unknown project", { projectId }, run, "not_found");
        }
        if (!operatorCanAccessProject(principal, projectId)) {
            return this.audited(principal, command, "denied", undefined, `operator may not act on project "${projectId}"`, { projectId }, run);
        }
        return this.runPlanning(principal, command, undefined, { projectId }, run, () => {
            const plan = planning.createPlan(input, {
                id: principal.id,
                correlationId: run.correlationId,
            });
            return { plan, reason: `execution plan created (${plan.status})` };
        });
    }
    /** Re-evaluate the current revision; creates a new version when inputs changed. */
    async replanExecutionPlan(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        const command = "replan_execution_plan";
        const check = this.resolvePlan(principal, command, input?.planId, run);
        if (!check.ok)
            return check.result;
        const { planning, plan } = check;
        return this.runPlanning(principal, command, plan.planId, { projectId: plan.projectId }, run, () => {
            const result = planning.replan(plan.planId, {
                id: principal.id,
                correlationId: run.correlationId,
            });
            return {
                plan: result.plan,
                reason: result.outcome === "unchanged"
                    ? "inputs unchanged — current revision kept"
                    : `replanned as version ${result.plan.version} (${result.plan.status})`,
                extra: {
                    replanOutcome: result.outcome,
                    previousId: result.previous.id,
                },
            };
        });
    }
    /** Request human approval for a ready plan with protected stages. */
    async submitExecutionPlan(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        const command = "submit_execution_plan";
        const check = this.resolvePlan(principal, command, input?.planId, run);
        if (!check.ok)
            return check.result;
        const { planning, plan } = check;
        return this.runPlanning(principal, command, plan.planId, { projectId: plan.projectId }, run, () => {
            const next = planning.submitForApproval(plan.planId, {
                id: principal.id,
                correlationId: run.correlationId,
            });
            return {
                plan: next,
                reason: "approval requested — the plan is not executed",
                extra: { approvalId: next.approval.approvalId },
            };
        });
    }
    resolvePlan(principal, command, planIdRaw, run) {
        let planId;
        try {
            planId = requireId(planIdRaw, `${command}.planId`);
        }
        catch (error) {
            return {
                ok: false,
                result: this.audited(principal, command, "rejected", undefined, message(error), {}, run),
            };
        }
        if (!operatorCan(principal, command)) {
            return {
                ok: false,
                result: this.audited(principal, command, "denied", planId, `role "${principal.role}" may not ${command.replace(/_/g, " ")}`, {}, run),
            };
        }
        const planning = this.ctx.planning;
        const plan = planning?.latest(planId);
        if (!planning || !plan) {
            return {
                ok: false,
                result: this.audited(principal, command, "rejected", planId, "unknown execution plan", {}, run, "not_found"),
            };
        }
        if (!operatorCanAccessProject(principal, plan.projectId)) {
            return {
                ok: false,
                result: this.audited(principal, command, "denied", planId, `operator may not act on project "${plan.projectId}"`, { projectId: plan.projectId }, run),
            };
        }
        return { ok: true, planning, plan };
    }
    /** Run a planning operation and map domain errors to control outcomes. */
    runPlanning(principal, command, resourceId, details, run, operation) {
        try {
            const { plan, reason, extra } = operation();
            return this.audited(principal, command, "executed", plan.id, reason, {
                ...details,
                planId: plan.planId,
                version: plan.version,
                status: plan.status,
                blockerCodes: plan.blockers.map((b) => b.code),
                ...extra,
            }, run);
        }
        catch (error) {
            const kind = error instanceof NotFoundError
                ? "not_found"
                : error instanceof StateTransitionError
                    ? "invalid_state"
                    : error instanceof ValidationError
                        ? "invalid_request"
                        : "command_failure";
            return this.audited(principal, command, "rejected", resourceId, message(error), details, run, kind);
        }
    }
    /* -------------------------------------------------------------- */
    /* tasks                                                         */
    /* -------------------------------------------------------------- */
    async cancelTask(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        const check = this.resolveTask(principal, "cancel_task", input?.taskId, run);
        if (!check.ok)
            return check.result;
        const task = check.task;
        if (TERMINAL_TASK_STATUSES.has(task.status)) {
            return this.audited(principal, "cancel_task", "rejected", task.id, `task is already ${task.status}`, { projectId: task.projectId }, run, "invalid_state");
        }
        if (!this.ctx.tasks.canTransition(task.status, "cancelled")) {
            return this.audited(principal, "cancel_task", "rejected", task.id, `cannot cancel a task in status ${task.status}`, { projectId: task.projectId }, run, "invalid_state");
        }
        const next = this.ctx.tasks.transition(task.id, "cancelled", {
            error: input.reason
                ? `cancelled by operator ${principal.id}: ${input.reason}`
                : `cancelled by operator ${principal.id}`,
            metadata: { cancelledBy: principal.id },
        });
        return this.audited(principal, "cancel_task", "executed", task.id, "task cancelled", { projectId: task.projectId, status: next.status }, run);
    }
    async retryTask(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        const check = this.resolveTask(principal, "retry_task", input?.taskId, run);
        if (!check.ok)
            return check.result;
        const task = check.task;
        if (task.status !== "failed") {
            return this.audited(principal, "retry_task", "rejected", task.id, `only a failed task may be retried (status: ${task.status})`, { projectId: task.projectId }, run, "invalid_state");
        }
        if (typeof task.metadata.workflowId === "string") {
            return this.audited(principal, "retry_task", "rejected", task.id, "this task belongs to a workflow — retry it via the workflow, not directly", { projectId: task.projectId, workflowId: task.metadata.workflowId }, run, "invalid_state");
        }
        const lastError = task.errors.at(-1) ?? "";
        const reason = extractFailureReason(lastError);
        if (reason && !DEFAULT_RETRY_POLICY.retryableReasons.includes(reason)) {
            return this.audited(principal, "retry_task", "rejected", task.id, `failure reason "${reason}" is not retryable`, { projectId: task.projectId, reason }, run, "invalid_state");
        }
        const already = typeof task.metadata.controlRetryCount === "number"
            ? task.metadata.controlRetryCount
            : 0;
        if (already >= this.maxRetries) {
            return this.audited(principal, "retry_task", "rejected", task.id, `retry limit reached (${already}/${this.maxRetries})`, { projectId: task.projectId }, run, "invalid_state");
        }
        const next = this.ctx.tasks.transition(task.id, "queued", {
            metadata: {
                controlRetryCount: already + 1,
                retriedBy: principal.id,
            },
        });
        return this.audited(principal, "retry_task", "executed", task.id, `task re-queued (attempt ${already + 1})`, { projectId: task.projectId, status: next.status, attempt: already + 1 }, run);
    }
    /* -------------------------------------------------------------- */
    /* workflows                                                     */
    /* -------------------------------------------------------------- */
    async pauseWorkflow(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        const check = this.resolveWorkflow(principal, "pause_workflow", input?.workflowId, run);
        if (!check.ok)
            return check.result;
        const workflow = check.workflow;
        if (TERMINAL_WORKFLOW_STATUSES.has(workflow.status)) {
            return this.audited(principal, "pause_workflow", "rejected", workflow.id, `workflow is already ${workflow.status}`, { projectId: workflow.projectId }, run, "invalid_state");
        }
        if (this.ctx.workflowControl.isPaused(workflow.id)) {
            return this.audited(principal, "pause_workflow", "rejected", workflow.id, "workflow is already paused", { projectId: workflow.projectId }, run, "invalid_state");
        }
        this.ctx.workflowControl.pause(workflow.id, principal.id, input.reason);
        return this.audited(principal, "pause_workflow", "executed", workflow.id, "workflow paused — no further task dispatch until resumed", { projectId: workflow.projectId, reason: input.reason }, run);
    }
    async resumeWorkflow(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        const check = this.resolveWorkflow(principal, "resume_workflow", input?.workflowId, run);
        if (!check.ok)
            return check.result;
        const workflow = check.workflow;
        if (TERMINAL_WORKFLOW_STATUSES.has(workflow.status)) {
            return this.audited(principal, "resume_workflow", "rejected", workflow.id, `workflow is already ${workflow.status}`, { projectId: workflow.projectId }, run, "invalid_state");
        }
        const wasPaused = this.ctx.workflowControl.isPaused(workflow.id);
        if (wasPaused) {
            this.ctx.workflowControl.resume(workflow.id, principal.id);
        }
        const enacted = { unpaused: wasPaused };
        if (workflow.status === "awaiting_approval" && this.ctx.workflowEngine) {
            try {
                const next = await this.ctx.workflowEngine.resume(workflow.id);
                enacted.engineResumed = true;
                enacted.workflowStatus = next.status;
            }
            catch (error) {
                enacted.engineResumeError = message(error);
            }
        }
        if (!wasPaused && !enacted.engineResumed) {
            return this.audited(principal, "resume_workflow", "rejected", workflow.id, `nothing to resume (status: ${workflow.status}, not paused)`, { projectId: workflow.projectId }, run, "invalid_state");
        }
        return this.audited(principal, "resume_workflow", "executed", workflow.id, "workflow resumed", { projectId: workflow.projectId, ...enacted }, run);
    }
    async cancelWorkflow(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        const check = this.resolveWorkflow(principal, "cancel_workflow", input?.workflowId, run);
        if (!check.ok)
            return check.result;
        const workflow = check.workflow;
        if (TERMINAL_WORKFLOW_STATUSES.has(workflow.status)) {
            return this.audited(principal, "cancel_workflow", "rejected", workflow.id, `workflow is already ${workflow.status}`, { projectId: workflow.projectId }, run, "invalid_state");
        }
        if (!this.ctx.workflows.canTransition(workflow.status, "cancelled")) {
            return this.audited(principal, "cancel_workflow", "rejected", workflow.id, `cannot cancel a workflow in status ${workflow.status}`, { projectId: workflow.projectId }, run, "invalid_state");
        }
        const next = this.ctx.workflows.transition(workflow.id, "cancelled", {
            error: input.reason
                ? `cancelled by operator ${principal.id}: ${input.reason}`
                : `cancelled by operator ${principal.id}`,
            metadata: { cancelledBy: principal.id },
        });
        return this.audited(principal, "cancel_workflow", "executed", workflow.id, "workflow cancelled", { projectId: workflow.projectId, status: next.status }, run);
    }
    /* -------------------------------------------------------------- */
    /* agents                                                        */
    /* -------------------------------------------------------------- */
    async disableAgent(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        return this.setAgentEnabled(principal, "disable_agent", input, false, run);
    }
    async enableAgent(principal, input, options) {
        const run = { correlationId: resolveCorrelationId(options) };
        return this.setAgentEnabled(principal, "enable_agent", input, true, run);
    }
    async setAgentEnabled(principal, command, input, enabled, run) {
        let agentId;
        try {
            agentId = requireId(input?.agentId, `${command}.agentId`);
        }
        catch (error) {
            return this.audited(principal, command, "rejected", undefined, message(error), {}, run);
        }
        if (!operatorCan(principal, command)) {
            return this.audited(principal, command, "denied", agentId, `role "${principal.role}" may not ${command.replace("_", " ")}`, {}, run);
        }
        if (!this.ctx.agents.has(agentId)) {
            return this.audited(principal, command, "rejected", agentId, "unknown agent", {}, run, "not_found");
        }
        const currentlyEnabled = this.ctx.agentOps.isEnabled(agentId);
        if (currentlyEnabled === enabled) {
            return this.audited(principal, command, "rejected", agentId, `agent is already ${enabled ? "enabled" : "disabled"}`, {}, run, "invalid_state");
        }
        if (enabled) {
            this.ctx.agentOps.enable(agentId, principal.id);
        }
        else {
            this.ctx.agentOps.disable(agentId, principal.id, input.reason ?? "disabled by operator");
        }
        return this.audited(principal, command, "executed", agentId, enabled
            ? "agent enabled — may receive new tasks again"
            : "agent disabled — will not receive new tasks; running work is left to finish", { reason: input.reason }, run);
    }
    /* -------------------------------------------------------------- */
    /* shared plumbing                                               */
    /* -------------------------------------------------------------- */
    resolveTask(principal, command, taskIdRaw, run) {
        let taskId;
        try {
            taskId = requireId(taskIdRaw, `${command}.taskId`);
        }
        catch (error) {
            return {
                ok: false,
                result: this.audited(principal, command, "rejected", undefined, message(error), {}, run),
            };
        }
        const capability = command === "retry_task" ? "retry_task" : "cancel_task";
        if (!operatorCan(principal, capability)) {
            return {
                ok: false,
                result: this.audited(principal, command, "denied", taskId, `role "${principal.role}" may not ${command.replace("_", " ")}`, {}, run),
            };
        }
        const task = this.ctx.tasks.get(taskId);
        if (!task) {
            return {
                ok: false,
                result: this.audited(principal, command, "rejected", taskId, "unknown task", {}, run, "not_found"),
            };
        }
        if (!operatorCanAccessProject(principal, task.projectId)) {
            return {
                ok: false,
                result: this.audited(principal, command, "denied", taskId, `operator may not act on project "${task.projectId}"`, { projectId: task.projectId }, run),
            };
        }
        return { ok: true, task };
    }
    resolveWorkflow(principal, command, workflowIdRaw, run) {
        let workflowId;
        try {
            workflowId = requireId(workflowIdRaw, `${command}.workflowId`);
        }
        catch (error) {
            return {
                ok: false,
                result: this.audited(principal, command, "rejected", undefined, message(error), {}, run),
            };
        }
        if (!operatorCan(principal, command)) {
            return {
                ok: false,
                result: this.audited(principal, command, "denied", workflowId, `role "${principal.role}" may not ${command.replace("_", " ")}`, {}, run),
            };
        }
        const workflow = this.ctx.workflows.get(workflowId);
        if (!workflow) {
            return {
                ok: false,
                result: this.audited(principal, command, "rejected", workflowId, "unknown workflow", {}, run, "not_found"),
            };
        }
        if (!operatorCanAccessProject(principal, workflow.projectId)) {
            return {
                ok: false,
                result: this.audited(principal, command, "denied", workflowId, `operator may not act on project "${workflow.projectId}"`, { projectId: workflow.projectId }, run),
            };
        }
        return { ok: true, workflow };
    }
    /**
     * Record a `control_command` audit event and return the structured result.
     * `errorKind` refines a non-`executed` outcome; when omitted it defaults to
     * `forbidden` for a denial and `invalid_request` for a rejection.
     */
    audited(principal, command, outcome, resourceId, reason, details, run, errorKind) {
        // Validate the principal shape even on the failure paths.
        try {
            validateOperatorPrincipal(principal);
        }
        catch {
            /* fall through — the event still records what was attempted */
        }
        const kind = outcome === "executed"
            ? undefined
            : (errorKind ??
                (outcome === "denied" ? "forbidden" : "invalid_request"));
        const projectId = typeof details.projectId === "string" ? details.projectId : undefined;
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
        const result = {
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
    publish(result) {
        if (!this.ctx.events)
            return;
        try {
            this.ctx.events.publish({ kind: "command_result", result });
        }
        catch {
            /* the command already succeeded/failed on its own terms */
        }
    }
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
