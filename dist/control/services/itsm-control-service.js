export class ITSMControlService {
    services;
    incidents;
    problems;
    changes;
    releases;
    cis;
    serviceRequests;
    runbooks;
    ciRels;
    constructor(services, incidents, problems, changes, releases, cis, serviceRequests, runbooks, ciRels) {
        this.services = services;
        this.incidents = incidents;
        this.problems = problems;
        this.changes = changes;
        this.releases = releases;
        this.cis = cis;
        this.serviceRequests = serviceRequests;
        this.runbooks = runbooks;
        this.ciRels = ciRels;
    }
    async createService(service) {
        const newService = {
            ...service,
            id: `svc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.services.upsert(newService);
        return newService;
    }
    async getService(organizationId, id) {
        const s = this.services.findById(id);
        if (s && s.organizationId === organizationId)
            return s;
        return null;
    }
    async listServices(organizationId) {
        return this.services.list().filter(s => s.organizationId === organizationId);
    }
    async createIncident(incident) {
        const newIncident = {
            ...incident,
            id: `inc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            createdAt: new Date().toISOString()
        };
        // Basic routing logic
        if (incident.severity === "critical" || incident.severity === "major") {
            newIncident.majorIncident = true;
            newIncident.assignmentGroup = "Major Incident Team";
        }
        else {
            newIncident.assignmentGroup = "L1 Support";
        }
        this.incidents.upsert(newIncident);
        return newIncident;
    }
    async updateIncident(organizationId, id, updates) {
        const existing = this.incidents.findById(id);
        if (!existing || existing.organizationId !== organizationId)
            throw new Error("Incident not found");
        const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
        if (updates.status === "resolved" && !existing.resolvedAt) {
            updated.resolvedAt = new Date().toISOString();
        }
        this.incidents.upsert(updated);
        return updated;
    }
    async listIncidents(organizationId, serviceId) {
        const all = this.incidents.list().filter(i => i.organizationId === organizationId);
        if (serviceId) {
            return all.filter(i => i.serviceId === serviceId);
        }
        return all;
    }
    async routeIncident(organizationId, incidentId) {
        const incident = this.incidents.findById(incidentId);
        if (!incident || incident.organizationId !== organizationId)
            throw new Error("Incident not found");
        let group = "L1 Support";
        if (incident.severity === "critical" || incident.severity === "major") {
            group = "Major Incident Team";
        }
        else if (incident.serviceId.includes("db")) {
            group = "Database Team";
        }
        else if (incident.serviceId.includes("network")) {
            group = "Network Team";
        }
        incident.assignmentGroup = group;
        incident.updatedAt = new Date().toISOString();
        this.incidents.upsert(incident);
        return incident;
    }
    async createProblem(problem) {
        const newProblem = {
            ...problem,
            id: `prb_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            createdAt: new Date().toISOString()
        };
        this.problems.upsert(newProblem);
        return newProblem;
    }
    async updateProblem(organizationId, id, updates) {
        const existing = this.problems.findById(id);
        if (!existing || existing.organizationId !== organizationId)
            throw new Error("Problem not found");
        const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
        this.problems.upsert(updated);
        return updated;
    }
    async createChangeRequest(cr) {
        const newCr = {
            ...cr,
            id: `cr_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            createdAt: new Date().toISOString()
        };
        // CAB logic
        if (newCr.type === "normal" || newCr.type === "emergency") {
            newCr.cabRequired = true;
            newCr.cabApprovalStatus = "pending";
        }
        else {
            newCr.cabRequired = false;
        }
        this.changes.upsert(newCr);
        return newCr;
    }
    async updateChangeRequest(organizationId, id, updates) {
        const existing = this.changes.findById(id);
        if (!existing || existing.organizationId !== organizationId)
            throw new Error("ChangeRequest not found");
        const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
        this.changes.upsert(updated);
        return updated;
    }
    async approveChange(organizationId, id, approverId) {
        const existing = this.changes.findById(id);
        if (!existing || existing.organizationId !== organizationId)
            throw new Error("ChangeRequest not found");
        if (!existing.cabRequired)
            throw new Error("Change does not require CAB approval");
        const updated = {
            ...existing,
            cabApprovalStatus: "approved",
            approvedBy: approverId,
            status: "approved",
            updatedAt: new Date().toISOString()
        };
        this.changes.upsert(updated);
        return updated;
    }
    async listChangeRequests(organizationId) {
        return this.changes.list().filter(cr => cr.organizationId === organizationId);
    }
    async createCI(ci) {
        const newCI = {
            ...ci,
            id: `ci_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            createdAt: new Date().toISOString()
        };
        this.cis.upsert(newCI);
        return newCI;
    }
    async addCIRelationship(rel) {
        const newRel = {
            ...rel,
            id: `rel_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            createdAt: new Date().toISOString()
        };
        this.ciRels.upsert(newRel);
        return newRel;
    }
    async getCIDependencies(organizationId, ciId) {
        const rels = this.ciRels.list().filter(r => r.organizationId === organizationId && r.sourceCiId === ciId);
        const deps = rels.map(r => this.cis.findById(r.targetCiId)).filter(Boolean);
        return deps;
    }
}
