import { operatorCanAccessProject, } from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";
export class SecurityControlService {
    events;
    policies;
    threatIntel;
    canonicalEvents;
    constructor(events, policies, threatIntel, canonicalEvents) {
        this.events = events;
        this.policies = policies;
        this.threatIntel = threatIntel;
        this.canonicalEvents = canonicalEvents;
    }
    enforceAdmin(operator) {
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires admin role for Security operations.");
        }
    }
    async listEvents(operator) {
        this.enforceAdmin(operator);
        return this.events.list();
    }
    async logEvent(event) {
        const newEvent = {
            ...event,
            id: `sec_evt_${Date.now()}`,
            eventId: `sec_evt_${Date.now()}`,
            status: "OPEN",
            createdAt: new Date().toISOString(),
        };
        this.events.upsert(newEvent);
        return newEvent;
    }
    async listPolicies(operator) {
        this.enforceAdmin(operator);
        return this.policies.list();
    }
    async listCanonicalEvents(operator, query = {}) {
        this.enforceAdmin(operator);
        if (query.projectId && !operatorCanAccessProject(operator, query.projectId))
            return [];
        if (operator.allowedProjects !== "*" && !query.projectId)
            return [];
        return this.canonicalEvents?.query(query) ?? [];
    }
}
