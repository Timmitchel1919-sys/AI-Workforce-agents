import {
  Service,
  Incident,
  ChangeRequest,
  Problem,
  ConfigurationItem,
  CIRelationship,
  ITSMControlPlane,
  ITSMRelease,
  ServiceRequest,
  Runbook
} from "../../contracts/itsm.js";
import { OperatorPrincipal } from "../../contracts/control.js";
import { Repository } from "../../contracts/persistence.js";

export class ITSMControlService implements ITSMControlPlane {
  constructor(
    private readonly services: Repository<Service>,
    private readonly incidents: Repository<Incident>,
    private readonly problems: Repository<Problem>,
    private readonly changes: Repository<ChangeRequest>,
    private readonly releases: Repository<ITSMRelease>,
    private readonly cis: Repository<ConfigurationItem>,
    private readonly serviceRequests: Repository<ServiceRequest>,
    private readonly runbooks: Repository<Runbook>,
    private readonly ciRels: Repository<CIRelationship>
  ) {}

  async createService(service: Omit<Service, "id" | "createdAt" | "updatedAt">): Promise<Service> {
    const newService: Service = {
      ...service,
      id: `svc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.services.upsert(newService);
    return newService;
  }

  async getService(organizationId: string, id: string): Promise<Service | null> {
    const s = this.services.findById(id);
    if (s && s.organizationId === organizationId) return s;
    return null;
  }

  async listServices(organizationId: string): Promise<Service[]> {
    return this.services.list().filter(s => s.organizationId === organizationId);
  }

  async createIncident(incident: Omit<Incident, "id" | "createdAt">): Promise<Incident> {
    const newIncident: Incident = {
      ...incident,
      id: `inc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString()
    };
    // Basic routing logic
    if (incident.severity === "critical" || incident.severity === "major") {
      newIncident.majorIncident = true;
      newIncident.assignmentGroup = "Major Incident Team";
    } else {
      newIncident.assignmentGroup = "L1 Support";
    }
    
    this.incidents.upsert(newIncident);
    return newIncident;
  }

  async updateIncident(organizationId: string, id: string, updates: Partial<Incident>): Promise<Incident> {
    const existing = this.incidents.findById(id);
    if (!existing || existing.organizationId !== organizationId) throw new Error("Incident not found");
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    if (updates.status === "resolved" && !existing.resolvedAt) {
      updated.resolvedAt = new Date().toISOString();
    }
    this.incidents.upsert(updated);
    return updated;
  }

  async listIncidents(organizationId: string, serviceId?: string): Promise<Incident[]> {
    const all = this.incidents.list().filter(i => i.organizationId === organizationId);
    if (serviceId) {
      return all.filter(i => i.serviceId === serviceId);
    }
    return all;
  }

  async routeIncident(organizationId: string, incidentId: string): Promise<Incident> {
    const incident = this.incidents.findById(incidentId);
    if (!incident || incident.organizationId !== organizationId) throw new Error("Incident not found");
    
    let group = "L1 Support";
    if (incident.severity === "critical" || incident.severity === "major") {
      group = "Major Incident Team";
    } else if (incident.serviceId.includes("db")) {
      group = "Database Team";
    } else if (incident.serviceId.includes("network")) {
      group = "Network Team";
    }

    incident.assignmentGroup = group;
    incident.updatedAt = new Date().toISOString();
    this.incidents.upsert(incident);
    return incident;
  }

  async createProblem(problem: Omit<Problem, "id" | "createdAt">): Promise<Problem> {
    const newProblem: Problem = {
      ...problem,
      id: `prb_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString()
    };
    this.problems.upsert(newProblem);
    return newProblem;
  }

  async updateProblem(organizationId: string, id: string, updates: Partial<Problem>): Promise<Problem> {
    const existing = this.problems.findById(id);
    if (!existing || existing.organizationId !== organizationId) throw new Error("Problem not found");
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.problems.upsert(updated);
    return updated;
  }

  async createChangeRequest(cr: Omit<ChangeRequest, "id" | "createdAt">): Promise<ChangeRequest> {
    const newCr: ChangeRequest = {
      ...cr,
      id: `cr_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString()
    };
    
    // CAB logic
    if (newCr.type === "normal" || newCr.type === "emergency") {
      newCr.cabRequired = true;
      newCr.cabApprovalStatus = "pending";
    } else {
      newCr.cabRequired = false;
    }

    this.changes.upsert(newCr);
    return newCr;
  }

  async updateChangeRequest(organizationId: string, id: string, updates: Partial<ChangeRequest>): Promise<ChangeRequest> {
    const existing = this.changes.findById(id);
    if (!existing || existing.organizationId !== organizationId) throw new Error("ChangeRequest not found");
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.changes.upsert(updated);
    return updated;
  }

  async approveChange(organizationId: string, id: string, approverId: string): Promise<ChangeRequest> {
    const existing = this.changes.findById(id);
    if (!existing || existing.organizationId !== organizationId) throw new Error("ChangeRequest not found");
    if (!existing.cabRequired) throw new Error("Change does not require CAB approval");
    
    const updated = { 
      ...existing, 
      cabApprovalStatus: "approved" as const, 
      approvedBy: approverId,
      status: "approved" as const,
      updatedAt: new Date().toISOString()
    };
    this.changes.upsert(updated);
    return updated;
  }

  async listChangeRequests(organizationId: string): Promise<ChangeRequest[]> {
    return this.changes.list().filter(cr => cr.organizationId === organizationId);
  }

  async createCI(ci: Omit<ConfigurationItem, "id" | "createdAt">): Promise<ConfigurationItem> {
    const newCI: ConfigurationItem = {
      ...ci,
      id: `ci_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString()
    };
    this.cis.upsert(newCI);
    return newCI;
  }

  async addCIRelationship(rel: Omit<CIRelationship, "id" | "createdAt">): Promise<CIRelationship> {
    const newRel: CIRelationship = {
      ...rel,
      id: `rel_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString()
    };
    this.ciRels.upsert(newRel);
    return newRel;
  }

  async getCIDependencies(organizationId: string, ciId: string): Promise<ConfigurationItem[]> {
    const rels = this.ciRels.list().filter(r => r.organizationId === organizationId && r.sourceCiId === ciId);
    const deps = rels.map(r => this.cis.findById(r.targetCiId)).filter(Boolean) as ConfigurationItem[];
    return deps;
  }
}
