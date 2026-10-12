/**
 * RuntimeControlService — the governed read/command surface for the Execution
 * Runtime and the Live Development Workspace (Layer 5).
 *
 * Reads need `view` plus access to the session's project; a foreign session is
 * indistinguishable from a missing one. File inspection goes through the same
 * governed file system the agents use (path guard, sensitive files hidden,
 * secrets masked). Commands need `orchestrate_execution`, are audited as
 * `control_command`, and never accept a command line or a path to run.
 */
import { NotFoundError, PermissionDeniedError, StateTransitionError, ValidationError, operatorCan, operatorCanAccessProject, } from "../../contracts/index.js";
import { TERMINAL_RUNTIME_STATES, } from "../../contracts/execution-runtime.js";
import { GovernedFileSystem } from "../../core/index.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";
export class RuntimeControlService {
    sessions;
    resolver;
    orchestrator;
    audit;
    clock;
    constructor(sessions, resolver, orchestrator, audit, clock = () => new Date().toISOString()) {
        this.sessions = sessions;
        this.resolver = resolver;
        this.orchestrator = orchestrator;
        this.audit = audit;
        this.clock = clock;
    }
    requireReader(principal) {
        if (!operatorCan(principal, "view"))
            throw new PermissionDeniedError("insufficient capabilities");
    }
    mustSee(principal, executionId) {
        if (typeof executionId !== "string" || executionId === "")
            throw new ValidationError("executionId is required");
        const session = this.sessions.live(executionId);
        if (!session || !operatorCanAccessProject(principal, session.projectId)) {
            throw new NotFoundError("execution not found");
        }
        return session;
    }
    /* ---- reads ---- */
    overview(principal) {
        this.requireReader(principal);
        this.sessions.recoverStale();
        const visible = new Set(this.sessions
            .list()
            .map((s) => s.projectId)
            .filter((p) => operatorCanAccessProject(principal, p)));
        const stats = this.orchestrator?.stats(principal);
        return this.sessions.overview(visible, stats?.queued ?? 0, stats?.waitingApproval ?? 0);
    }
    list(principal, filter = {}) {
        this.requireReader(principal);
        this.sessions.recoverStale();
        return this.sessions
            .list({
            ...(filter.projectId ? { projectId: filter.projectId } : {}),
            ...(filter.runId ? { runId: filter.runId } : {}),
        })
            .filter((s) => operatorCanAccessProject(principal, s.projectId))
            .slice(0, Math.min(Math.max(filter.limit ?? 50, 1), 200))
            .map((s) => this.sessions.summary(s));
    }
    get(principal, executionId) {
        this.requireReader(principal);
        this.sessions.recoverStale();
        return structuredClone(this.mustSee(principal, executionId));
    }
    /** Long-poll: resolves as soon as there are events after `after`, or after `waitMs`. */
    async events(principal, executionId, after, waitMs) {
        this.requireReader(principal);
        const session = this.mustSee(principal, executionId);
        if (!Number.isInteger(after) || after < 0)
            throw new ValidationError("after must be a non-negative integer");
        const events = await this.sessions.waitForEvents(executionId, after, Math.min(Math.max(waitMs, 0), 25_000));
        return {
            events,
            status: session.status,
            done: TERMINAL_RUNTIME_STATES.includes(session.status),
        };
    }
    async workspace(principal, executionId) {
        this.requireReader(principal);
        const session = this.mustSee(principal, executionId);
        return (await this.resolver.resolve(session.projectId)).descriptor;
    }
    async tree(principal, executionId, dir) {
        const fs = await this.fileSystem(principal, executionId);
        return fs.tree(dir);
    }
    async file(principal, executionId, path) {
        const fs = await this.fileSystem(principal, executionId);
        return fs.read(path);
    }
    async fileSystem(principal, executionId) {
        this.requireReader(principal);
        const session = this.mustSee(principal, executionId);
        const workspace = await this.resolver.resolve(session.projectId);
        // A READ-ONLY view: whatever the workspace permits, an inspector can only read and list.
        return new GovernedFileSystem(workspace.rootReal, ["read", "list"], {
            taskId: session.taskId,
            agentId: `user:${principal.id}`,
            clock: this.clock,
        });
    }
    /* ---- commands ---- */
    runtimeCancelSession(p, b, o) {
        return this.command(p, "runtime_cancel_session", b, o, (s) => {
            if (TERMINAL_RUNTIME_STATES.includes(s.status))
                throw new StateTransitionError(`the execution is already ${s.status}`);
            this.sessions.cancel(s.executionId);
        });
    }
    runtimePauseSession(p, b, o) {
        return this.command(p, "runtime_pause_session", b, o, (s) => {
            if (TERMINAL_RUNTIME_STATES.includes(s.status))
                throw new StateTransitionError(`the execution is already ${s.status}`);
            this.sessions.pause(s);
        });
    }
    runtimeResumeSession(p, b, o) {
        return this.command(p, "runtime_resume_session", b, o, (s) => {
            if (!s.paused)
                throw new StateTransitionError("the execution is not paused");
            this.sessions.resume(s);
        });
    }
    command(principal, command, body, options, action) {
        const correlationId = resolveCorrelationId(options);
        const resourceId = typeof body?.["executionId"] === "string"
            ? body["executionId"]
            : undefined;
        try {
            if (!operatorCan(principal, "orchestrate_execution")) {
                throw new PermissionDeniedError(`role "${principal.role}" may not control executions`);
            }
            const session = this.mustSee(principal, body?.["executionId"]);
            action(session);
            return this.result(principal, command, "executed", undefined, "ok", resourceId, correlationId, {
                projectId: session.projectId,
                executionId: session.executionId,
                status: session.status,
                paused: session.paused,
            });
        }
        catch (error) {
            const { outcome, kind } = classify(error);
            return this.result(principal, command, outcome, kind, errorText(error), resourceId, correlationId, {});
        }
    }
    result(principal, command, outcome, errorKind, reason, resourceId, correlationId, details) {
        const event = this.audit.record("control_command", {
            projectId: typeof details["projectId"] === "string"
                ? details["projectId"]
                : undefined,
            data: {
                ...redact(details),
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
            details: redact(details),
            auditEventId: event.id,
            timestamp: this.clock(),
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
