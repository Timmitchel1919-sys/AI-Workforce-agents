export type ServiceStatus = "operational" | "degraded" | "outage" | "maintenance";
export type IncidentSeverity = "low" | "medium" | "high" | "critical" | "major";
export type ChangeType = "standard" | "normal" | "emergency";
export type ChangeStatus = "draft" | "pending_approval" | "approved" | "scheduled" | "implementing" | "review" | "closed" | "canceled" | "rejected";
export type ITSMReleaseStatus = "planning" | "building" | "testing" | "deploying" | "deployed" | "failed" | "rolled_back";
export interface BaseITSMRecord {
    id: string;
    organizationId: string;
    createdAt: string;
    updatedAt?: string;
}
export interface Service extends BaseITSMRecord {
    name: string;
    description: string;
    ownerId: string;
    status: ServiceStatus;
    slaId?: string;
    sloTargets?: Record<string, number>;
}
export interface ConfigurationItem extends BaseITSMRecord {
    name: string;
    ciType: string;
    serviceId?: string;
    status: string;
    attributes?: Record<string, any>;
}
export interface CIRelationship extends BaseITSMRecord {
    sourceCiId: string;
    targetCiId: string;
    relationshipType: "depends_on" | "hosts" | "contains" | "connects_to";
}
export interface Incident extends BaseITSMRecord {
    title: string;
    description: string;
    serviceId: string;
    severity: IncidentSeverity;
    status: "new" | "in_progress" | "resolved" | "closed";
    assignedTo?: string;
    assignmentGroup?: string;
    majorIncident: boolean;
    resolvedAt?: string;
}
export interface Problem extends BaseITSMRecord {
    title: string;
    description: string;
    serviceId: string;
    status: "investigating" | "identified" | "known_error" | "resolved";
    rootCause?: string;
    workaround?: string;
    incidentIds?: string[];
}
export interface ChangeRequest extends BaseITSMRecord {
    title: string;
    description: string;
    type: ChangeType;
    status: ChangeStatus;
    serviceId: string;
    requestedBy: string;
    approvedBy?: string;
    cabRequired?: boolean;
    cabApprovalStatus?: "pending" | "approved" | "rejected";
    scheduledStart?: string;
    scheduledEnd?: string;
    ciIds?: string[];
}
export interface ITSMRelease extends BaseITSMRecord {
    title: string;
    status: ITSMReleaseStatus;
    serviceId: string;
    changeRequestId?: string;
    deployedAt?: string;
}
export interface ServiceRequest extends BaseITSMRecord {
    title: string;
    requestedBy: string;
    serviceId: string;
    status: "open" | "in_progress" | "fulfilled" | "rejected";
}
export interface Runbook extends BaseITSMRecord {
    title: string;
    serviceId: string;
    content: string;
    automationLevel: "manual" | "semi_automated" | "fully_automated";
}
export interface ITSMControlPlane {
    getService(organizationId: string, id: string): Promise<Service | null>;
    listServices(organizationId: string): Promise<Service[]>;
    createService(service: Omit<Service, "id" | "createdAt" | "updatedAt">): Promise<Service>;
    createIncident(incident: Omit<Incident, "id" | "createdAt">): Promise<Incident>;
    updateIncident(organizationId: string, id: string, updates: Partial<Incident>): Promise<Incident>;
    listIncidents(organizationId: string, serviceId?: string): Promise<Incident[]>;
    routeIncident(organizationId: string, incidentId: string): Promise<Incident>;
    createProblem(problem: Omit<Problem, "id" | "createdAt">): Promise<Problem>;
    updateProblem(organizationId: string, id: string, updates: Partial<Problem>): Promise<Problem>;
    createChangeRequest(cr: Omit<ChangeRequest, "id" | "createdAt">): Promise<ChangeRequest>;
    updateChangeRequest(organizationId: string, id: string, updates: Partial<ChangeRequest>): Promise<ChangeRequest>;
    approveChange(organizationId: string, id: string, approverId: string): Promise<ChangeRequest>;
    listChangeRequests(organizationId: string): Promise<ChangeRequest[]>;
    createCI(ci: Omit<ConfigurationItem, "id" | "createdAt">): Promise<ConfigurationItem>;
    addCIRelationship(rel: Omit<CIRelationship, "id" | "createdAt">): Promise<CIRelationship>;
    getCIDependencies(organizationId: string, ciId: string): Promise<ConfigurationItem[]>;
}
