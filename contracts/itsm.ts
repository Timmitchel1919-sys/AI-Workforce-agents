export type ServiceStatus = "operational" | "degraded" | "outage" | "maintenance";
export type IncidentSeverity = "low" | "medium" | "high" | "critical" | "major";
export type ChangeType = "standard" | "normal" | "emergency";
export type ChangeStatus = "draft" | "pending_approval" | "approved" | "scheduled" | "implementing" | "review" | "closed" | "canceled" | "rejected";
export type ITSMReleaseStatus = "planning" | "building" | "testing" | "deploying" | "deployed" | "failed" | "rolled_back";

export interface Service {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  status: ServiceStatus;
  slaId?: string;
  sloTargets?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigurationItem {
  id: string;
  name: string;
  ciType: string;
  serviceId?: string;
  status: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  serviceId: string;
  severity: IncidentSeverity;
  status: "new" | "in_progress" | "resolved" | "closed";
  assignedTo?: string;
  majorIncident: boolean;
  createdAt: string;
  resolvedAt?: string;
}

export interface Problem {
  id: string;
  title: string;
  description: string;
  serviceId: string;
  status: "investigating" | "identified" | "known_error" | "resolved";
  rootCause?: string;
  workaround?: string;
  createdAt: string;
}

export interface ChangeRequest {
  id: string;
  title: string;
  description: string;
  type: ChangeType;
  status: ChangeStatus;
  serviceId: string;
  requestedBy: string;
  approvedBy?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  createdAt: string;
}

export interface ITSMRelease {
  id: string;
  title: string;
  status: ITSMReleaseStatus;
  serviceId: string;
  changeRequestId?: string;
  deployedAt?: string;
}

export interface ServiceRequest {
  id: string;
  title: string;
  requestedBy: string;
  serviceId: string;
  status: "open" | "in_progress" | "fulfilled" | "rejected";
}

export interface Runbook {
  id: string;
  title: string;
  serviceId: string;
  content: string;
  automationLevel: "manual" | "semi_automated" | "fully_automated";
}

export interface ITSMControlPlane {
  getService(id: string): Promise<Service | null>;
  listServices(): Promise<Service[]>;
  createIncident(incident: Omit<Incident, "id" | "createdAt">): Promise<Incident>;
  updateIncident(id: string, updates: Partial<Incident>): Promise<Incident>;
  listIncidents(serviceId?: string): Promise<Incident[]>;
  createChangeRequest(cr: Omit<ChangeRequest, "id" | "createdAt">): Promise<ChangeRequest>;
  listChangeRequests(): Promise<ChangeRequest[]>;
}
