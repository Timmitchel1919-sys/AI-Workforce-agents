/**
 * OnboardingControlService — the governed command/query surface for project
 * onboarding (PROJECT-2). Every command is authorized by the domain service,
 * audited as a `control_command` (denied and rejected included) and returned
 * as a structured `ControlCommandResult`. The UI never mutates state itself.
 */
import { NotFoundError, PermissionDeniedError, StateTransitionError, ValidationError, } from "../../contracts/index.js";
import { OnboardingConflictError, } from "../../core/index.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";
export class OnboardingControlService {
    service;
    audit;
    constructor(service, audit) {
        this.service = service;
        this.audit = audit;
    }
    capabilities(principal) {
        return this.service.capabilities(principal);
    }
    list(principal) {
        return this.service.list(principal);
    }
    get(principal, id) {
        return this.service.get(principal, id);
    }
    onboardingCreate(p, b, o) {
        return this.run(p, "onboarding_create", b, o, () => this.service.create(p, b));
    }
    onboardingUpdate(p, b, o) {
        return this.run(p, "onboarding_update", b, o, () => this.service.update(p, b));
    }
    onboardingAnalyze(p, b, o) {
        return this.run(p, "onboarding_analyze", b, o, () => this.service.analyze(p, b));
    }
    onboardingPlan(p, b, o) {
        return this.run(p, "onboarding_plan", b, o, () => this.service.plan(p, b));
    }
    onboardingApprovePlan(p, b, o) {
        return this.run(p, "onboarding_approve_plan", b, o, () => this.service.approvePlan(p, b));
    }
    onboardingProvision(p, b, o) {
        return this.run(p, "onboarding_provision", b, o, () => this.service.provision(p, b));
    }
    onboardingRevalidate(p, b, o) {
        return this.run(p, "onboarding_revalidate", b, o, () => this.service.revalidate(p, b));
    }
    onboardingCancel(p, b, o) {
        return this.run(p, "onboarding_cancel", b, o, () => this.service.cancel(p, b));
    }
    async run(principal, command, body, options, action) {
        const correlationId = resolveCorrelationId(options);
        const resourceId = typeof body?.["id"] === "string" ? body["id"] : undefined;
        try {
            const outcome = await action();
            const s = outcome.session;
            return this.result(principal, command, "executed", undefined, outcome.note ?? "ok", s.id, correlationId, {
                projectId: s.projectId,
                status: s.status,
                revision: s.revision,
                idempotent: outcome.idempotent === true,
                session: s,
            });
        }
        catch (error) {
            const { outcome, kind, details } = classify(error);
            return this.result(principal, command, outcome, kind, errorText(error), resourceId, correlationId, details);
        }
    }
    result(principal, command, outcome, errorKind, reason, resourceId, correlationId, details) {
        // The audit copy never carries the full session (it is large and not needed).
        const { session: _session, ...auditDetails } = details;
        void _session;
        const event = this.audit.record("control_command", {
            projectId: typeof details["projectId"] === "string" ? details["projectId"] : undefined,
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
            // The session is already free of secrets by construction; do not
            // redact/truncate it (the browser renders it).
            details: { ...redact(auditDetails), ...(details["session"] ? { session: details["session"] } : {}) },
            auditEventId: event.id,
            timestamp: new Date().toISOString(),
        };
    }
}
function classify(error) {
    if (error instanceof PermissionDeniedError)
        return { outcome: "denied", kind: "forbidden", details: {} };
    if (error instanceof OnboardingConflictError) {
        return {
            outcome: "rejected",
            kind: "invalid_state",
            details: { code: error.code, ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}) },
        };
    }
    if (error instanceof NotFoundError)
        return { outcome: "rejected", kind: "not_found", details: {} };
    if (error instanceof StateTransitionError)
        return { outcome: "rejected", kind: "invalid_state", details: {} };
    if (error instanceof ValidationError)
        return { outcome: "rejected", kind: "invalid_request", details: {} };
    return { outcome: "rejected", kind: "command_failure", details: {} };
}
function errorText(error) {
    if (error instanceof Error && !(error.constructor === Error))
        return error.message;
    return "the command failed";
}
