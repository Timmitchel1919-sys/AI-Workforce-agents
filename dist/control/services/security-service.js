import { ValidationError } from "../../contracts/index.js";
export class SecurityControlService {
    events;
    policies;
    threatIntel;
    constructor(events, policies, threatIntel) {
        this.events = events;
        this.policies = policies;
        this.threatIntel = threatIntel;
    }
    enforceAdmin(operator) {
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires admin role for Security operations.");
        }
    }
    async listEvents() {
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
    async listPolicies() {
        return this.policies.list();
    }
}
