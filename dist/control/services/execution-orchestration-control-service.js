/**
 * ExecutionOrchestrationControlService — the governed command/query surface
 * for Execution Orchestration (Layer 4).
 *
 * Every command is authorized by the orchestrator, audited as a
 * `control_command` (denied and rejected included) and returned as a
 * structured `ControlCommandResult`. The UI never mutates run state itself.
 */
import { NotFoundError, PermissionDeniedError, StateTransitionError, ValidationError, } from "../../contracts/index.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";
export class ExecutionOrchestrationControlService {
    orchestrator;
    prompts;
    audit;
    constructor(orchestrator, prompts, audit) {
        this.orchestrator = orchestrator;
        this.prompts = prompts;
        this.audit = audit;
    }
    list(principal, filter = {}) {
        return this.orchestrator.list(principal, filter);
    }
    get(principal, runId) {
        return this.orchestrator.get(principal, runId);
    }
    orchestrationCreate(p, b, o) {
        return this.run(p, "orchestration_create", b, o, async () => {
            const requestId = typeof b?.["requestId"] === "string" ? b["requestId"] : "";
            if (requestId === "")
                throw new ValidationError("requestId is required");
            // Layer 3 enforces who may read the request; the orchestrator re-checks the project.
            return this.orchestrator.createRun(p, this.prompts.get(p, requestId));
        });
    }
    /** Start = mark the run started (asking for destructive approvals) and advance once. */
    orchestrationStart(p, b, o) {
        return this.run(p, "orchestration_start", b, o, async () => {
            this.orchestrator.start(p, b?.["runId"]);
            return this.orchestrator.advance(p, b?.["runId"]);
        });
    }
    orchestrationAdvance(p, b, o) {
        return this.run(p, "orchestration_advance", b, o, async () => {
            const steps = typeof b?.["maxSteps"] === "number"
                ? b["maxSteps"]
                : undefined;
            return this.orchestrator.advance(p, b?.["runId"], steps);
        });
    }
    orchestrationPause(p, b, o) {
        return this.run(p, "orchestration_pause", b, o, async () => this.orchestrator.pause(p, b?.["runId"]));
    }
    orchestrationResume(p, b, o) {
        return this.run(p, "orchestration_resume", b, o, async () => this.orchestrator.resume(p, b?.["runId"]));
    }
    orchestrationCancel(p, b, o) {
        return this.run(p, "orchestration_cancel", b, o, async () => this.orchestrator.cancel(p, b?.["runId"]));
    }
    orchestrationRetryTask(p, b, o) {
        return this.run(p, "orchestration_retry_task", b, o, async () => this.orchestrator.retryTask(p, b?.["runId"], b?.["taskId"]));
    }
    async run(principal, command, body, options, action) {
        const correlationId = resolveCorrelationId(options);
        const resourceId = typeof body?.["runId"] === "string"
            ? body["runId"]
            : undefined;
        try {
            const view = await action();
            return this.result(principal, command, "executed", undefined, "ok", view.run.runId, correlationId, {
                projectId: view.run.projectId,
                runId: view.run.runId,
                requestId: view.run.requestId,
                status: view.status,
                progress: view.progress,
                view,
            });
        }
        catch (error) {
            const { outcome, kind } = classify(error);
            return this.result(principal, command, outcome, kind, errorText(error), resourceId, correlationId, {});
        }
    }
    result(principal, command, outcome, errorKind, reason, resourceId, correlationId, details) {
        // The audit copy never carries the full run (tasks, prompts).
        const { view: _view, ...auditDetails } = details;
        void _view;
        const event = this.audit.record("control_command", {
            projectId: typeof details["projectId"] === "string"
                ? details["projectId"]
                : undefined,
            data: {
                ...redact(auditDetails),
                command,
                outcome,
                errorKind,
                correlationId,
                actor: principal?.id ?? "unknown",
                actorRole: principal?.role ?? "unknown",
                resourceId,
                reason,
            },
        });
        return {
            command,
            outcome,
            ok: outcome === "executed",
            errorKind,
            reason,
            resourceId,
            correlationId,
            details: {
                ...redact(auditDetails),
                ...(details["view"] ? { view: details["view"] } : {}),
            },
            auditEventId: event.id,
            timestamp: new Date().toISOString(),
        };
    }
}
function classify(error) {
    if (error instanceof PermissionDeniedError)
        return { outcome: "denied", kind: "forbidden" };
    if (error instanceof NotFoundError)
        return { outcome: "rejected", kind: "not_found" };
    if (error instanceof StateTransitionError)
        return { outcome: "rejected", kind: "invalid_state" };
    if (error instanceof ValidationError)
        return { outcome: "rejected", kind: "invalid_request" };
    return { outcome: "rejected", kind: "command_failure" };
}
function errorText(error) {
    if (error instanceof PermissionDeniedError ||
        error instanceof NotFoundError ||
        error instanceof StateTransitionError ||
        error instanceof ValidationError) {
        return error.message;
    }
    return "the command failed";
}
