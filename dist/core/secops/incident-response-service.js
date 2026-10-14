import { PermissionDeniedError, StateTransitionError, ValidationError, operatorCan, } from "../../contracts/index.js";
/**
 * Human-governed incident response. Detection can create incidents, but this
 * service is the only path that can request and execute containment. The
 * executor is injected by the authoritative subsystem; absent one, execution
 * fails closed and no agent, user or network resource is changed.
 */
export class IncidentResponseService {
    incidents;
    destructiveActions;
    scope;
    executor;
    constructor(incidents, destructiveActions, scope, executor) {
        this.incidents = incidents;
        this.destructiveActions = destructiveActions;
        this.scope = scope;
        this.executor = executor;
    }
    listIncidents(principal, organizationId) {
        this.assertScope(principal, organizationId);
        return this.incidents
            .list()
            .filter((incident) => incident.organizationId === organizationId);
    }
    updateStatus(principal, incidentId, organizationId, status) {
        if (!operatorCan(principal, "manage_security_incidents")) {
            throw new PermissionDeniedError("manage_security_incidents capability required");
        }
        this.assertScope(principal, organizationId);
        const incident = this.requireIncident(incidentId, organizationId);
        if (incident.status === "RESOLVED" && status !== "RESOLVED") {
            throw new StateTransitionError("resolved incident cannot be reopened");
        }
        const updated = {
            ...incident,
            status,
            resolvedAt: status === "RESOLVED"
                ? (incident.resolvedAt ?? new Date())
                : incident.resolvedAt,
        };
        this.incidents.upsert(updated);
        return updated;
    }
    requestContainment(principal, input) {
        this.assertScope(principal, input.organizationId);
        if (!input.reason.trim())
            throw new ValidationError("containment reason is required");
        const incident = this.requireIncident(input.incidentId, input.organizationId);
        if (incident.status === "RESOLVED")
            throw new StateTransitionError("resolved incident cannot be contained");
        return this.destructiveActions.request(principal, {
            actionType: "other_destructive",
            action: "security.incident.contain",
            // Bind approval to the incident itself. The authoritative executor
            // resolves the concrete resource from its own trusted state; client
            // supplied target ids never become an execution authority.
            targetResourceType: "incident",
            targetResourceId: input.incidentId,
            environment: input.environment,
            projectId: input.projectId,
            production: input.environment === "production",
            irreversible: false,
            justification: {
                summary: `Contain incident ${input.incidentId}`,
                reason: input.reason,
                blockerOrHindrance: "Uncontained security incident",
                expectedImpact: "Temporarily restrict the affected resource",
                affectedResources: [input.targetResourceId],
                affectedUsers: [],
                affectedWorkflows: [],
                affectedIntegrations: [],
                saferAlternatives: [
                    {
                        alternative: "quarantine",
                        feasible: true,
                        reason: "Limits blast radius",
                        recommended: true,
                    },
                ],
                selectedAlternativeReason: "Containment is reversible and limits blast radius",
                reversible: true,
                backupAvailable: true,
                recoveryPlan: "Remove containment after incident review",
                rollbackAvailable: true,
                dataRetentionImpact: "None",
                complianceImpact: "Recorded in the security audit trail",
                risk: "high",
            },
        }, input.correlationId);
    }
    async executeContainment(principal, destructiveActionId, incidentId, organizationId, evidence) {
        if (!operatorCan(principal, "contain_security_threat"))
            throw new PermissionDeniedError("contain_security_threat capability required");
        this.assertScope(principal, organizationId);
        const incident = this.requireIncident(incidentId, organizationId);
        const request = this.destructiveActions.get(destructiveActionId);
        if (!request)
            throw new ValidationError("containment request not found");
        if (request.action !== "security.incident.contain" ||
            (request.targetResourceType === "incident" &&
                request.targetResourceId !== incidentId)) {
            throw new ValidationError("containment request is not bound to this incident");
        }
        if (!this.executor)
            throw new PermissionDeniedError("containment executor is not configured; execution refused");
        const executing = this.destructiveActions.assertApproved({
            requestId: destructiveActionId,
            principal,
            actionType: request.actionType,
            targetResourceType: request.targetResourceType,
            targetResourceId: request.targetResourceId,
            environment: request.environment,
            projectId: request.projectId,
            evidence,
        });
        try {
            const result = await this.executor.execute({
                request: executing,
                incident,
                principal,
                ...evidence,
            });
            this.destructiveActions.markExecuted(destructiveActionId, principal.id, result);
            this.incidents.upsert({ ...incident, status: "MITIGATED" });
            return result;
        }
        catch (error) {
            this.destructiveActions.markFailed(destructiveActionId, principal.id, error instanceof Error ? error.message : "containment failed");
            throw error;
        }
    }
    requireIncident(id, organizationId) {
        const incident = this.incidents.findById(id);
        if (!incident || incident.organizationId !== organizationId)
            throw new PermissionDeniedError("incident is not accessible");
        return incident;
    }
    assertScope(principal, organizationId) {
        if (!this.scope.canAccess(principal, organizationId))
            throw new PermissionDeniedError("incident organization is not accessible");
    }
}
