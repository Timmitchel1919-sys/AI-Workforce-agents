import { type OperatorPrincipal, type Repository } from "../../contracts/index.js";
import type { DestructiveActionRequest, SecurityMfaEvidence, SecurityReauthenticationEvidence } from "../../contracts/destructive-action.js";
import type { SecurityIncident } from "../../contracts/secops.js";
import type { DestructiveActionService } from "../security/destructive-action-service.js";
export interface SecurityIncidentRecord extends SecurityIncident {
    id: string;
}
export interface ContainmentRequest {
    incidentId: string;
    organizationId: string;
    targetResourceType: string;
    targetResourceId: string;
    environment: "local" | "test" | "staging" | "production";
    projectId?: string;
    reason: string;
    correlationId: string;
}
export interface ContainmentExecutionContext {
    request: DestructiveActionRequest;
    incident: SecurityIncidentRecord;
    principal: OperatorPrincipal;
    mfa?: SecurityMfaEvidence;
    reauth?: SecurityReauthenticationEvidence;
}
export interface ContainmentExecutor {
    execute(context: ContainmentExecutionContext): Promise<Readonly<Record<string, unknown>>>;
}
export interface IncidentScopeAuthorizer {
    canAccess(principal: OperatorPrincipal, organizationId: string): boolean;
}
/**
 * Human-governed incident response. Detection can create incidents, but this
 * service is the only path that can request and execute containment. The
 * executor is injected by the authoritative subsystem; absent one, execution
 * fails closed and no agent, user or network resource is changed.
 */
export declare class IncidentResponseService {
    private readonly incidents;
    private readonly destructiveActions;
    private readonly scope;
    private readonly executor?;
    constructor(incidents: Repository<SecurityIncidentRecord>, destructiveActions: DestructiveActionService, scope: IncidentScopeAuthorizer, executor?: ContainmentExecutor | undefined);
    listIncidents(principal: OperatorPrincipal, organizationId: string): SecurityIncidentRecord[];
    updateStatus(principal: OperatorPrincipal, incidentId: string, organizationId: string, status: SecurityIncident["status"]): SecurityIncidentRecord;
    requestContainment(principal: OperatorPrincipal, input: ContainmentRequest): DestructiveActionRequest;
    executeContainment(principal: OperatorPrincipal, destructiveActionId: string, incidentId: string, organizationId: string, evidence: {
        mfa?: SecurityMfaEvidence;
        reauth?: SecurityReauthenticationEvidence;
    }): Promise<Readonly<Record<string, unknown>>>;
    private requireIncident;
    private assertScope;
}
