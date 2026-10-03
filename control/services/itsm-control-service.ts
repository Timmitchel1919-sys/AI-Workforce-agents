import {
  Service,
  Incident,
  ChangeRequest,
  Problem,
  ConfigurationItem,
  ITSMRelease,
  ServiceRequest,
  Runbook
} from "../../contracts/itsm.js";
import { OperatorPrincipal } from "../../contracts/control.js";
import { Repository } from "../../contracts/persistence.js";

export class ITSMControlService {
  constructor(
    private readonly services: Repository<Service>,
    private readonly incidents: Repository<Incident>,
    private readonly problems: Repository<Problem>,
    private readonly changes: Repository<ChangeRequest>,
    private readonly releases: Repository<ITSMRelease>,
    private readonly cis: Repository<ConfigurationItem>,
    private readonly serviceRequests: Repository<ServiceRequest>,
    private readonly runbooks: Repository<Runbook>
  ) {}

  async listServices(operator: OperatorPrincipal): Promise<Service[]> {
    return this.services.list();
  }

  async getService(operator: OperatorPrincipal, id: string): Promise<Service | undefined> {
    return this.services.findById(id);
  }

  async createService(operator: OperatorPrincipal, service: Omit<Service, "id" | "createdAt" | "updatedAt">): Promise<Service> {
    const newService: Service = {
      ...service,
      id: `svc_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.services.upsert(newService);
    return newService;
  }

  async listIncidents(operator: OperatorPrincipal, serviceId?: string): Promise<Incident[]> {
    const all = this.incidents.list();
    if (serviceId) {
      return all.filter(i => i.serviceId === serviceId);
    }
    return all;
  }

  async createIncident(operator: OperatorPrincipal, incident: Omit<Incident, "id" | "createdAt">): Promise<Incident> {
    const newIncident: Incident = {
      ...incident,
      id: `inc_${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    this.incidents.upsert(newIncident);
    return newIncident;
  }

  async updateIncident(operator: OperatorPrincipal, id: string, updates: Partial<Incident>): Promise<Incident> {
    const existing = this.incidents.findById(id);
    if (!existing) throw new Error("Incident not found");
    const updated = { ...existing, ...updates };
    if (updates.status === "resolved" && !existing.resolvedAt) {
      updated.resolvedAt = new Date().toISOString();
    }
    this.incidents.upsert(updated);
    return updated;
  }

  async createChangeRequest(operator: OperatorPrincipal, cr: Omit<ChangeRequest, "id" | "createdAt">): Promise<ChangeRequest> {
    const newCr: ChangeRequest = {
      ...cr,
      id: `cr_${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    this.changes.upsert(newCr);
    return newCr;
  }

  async listChangeRequests(operator: OperatorPrincipal): Promise<ChangeRequest[]> {
    return this.changes.list();
  }
}
