import { operatorCan, operatorCanAccessProject, } from "../../contracts/control.js";
import { PermissionDeniedError } from "../../contracts/index.js";
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
    /**
     * Deny-by-default authorization. Each security action maps to a specific
     * {@link ControlCapability}; the role → capability table lives in
     * `contracts/control.ts`. Unknown capabilities never silently pass.
     */
    requireCapability(operator, capability) {
        if (!operatorCan(operator, capability)) {
            throw new PermissionDeniedError(`Operator '${operator.id}' lacks required capability '${capability}'`);
        }
    }
    /**
     * Legacy ZTN event listing. Reading detailed event evidence is a security
     * capability (not an admin-role check): operators with `view_security_events`
     * may read, viewers may not. Mutation of events is handled server-side by
     * `logEvent`, not through this method.
     */
    async listEvents(operator) {
        this.requireCapability(operator, "view_security_events");
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
    /**
     * Reading policy POSTURE (what is in force) is a read capability
     * (`view_security`). Mutating policy is a separate capability
     * (`manage_security_policy`) and is NOT exposed by this method.
     */
    async listPolicies(operator) {
        this.requireCapability(operator, "view_security");
        return this.policies.list();
    }
    /**
     * Detailed canonical security events. Authorization is capability-based
     * (`view_security_events`), but project scope is independently enforced:
     *
     * - A query filtered by `projectId` must satisfy
     *   {@link operatorCanAccessProject}; a wrong project returns `[]`.
     * - A project-scoped operator (not `allowedProjects === "*"`) issuing a
     *   query WITHOUT `projectId` receives no data. We never widen scoped
     *   operators into unbounded global reads here, even when the capability
     *   grants them access to detailed events in principle.
     *
     * Admin principals with wildcard scope receive the unfiltered store query.
     */
    async listCanonicalEvents(operator, query = {}) {
        this.requireCapability(operator, "view_security_events");
        if (query.projectId && !operatorCanAccessProject(operator, query.projectId))
            return [];
        if (operator.allowedProjects !== "*" && !query.projectId)
            return [];
        if (!this.canonicalEvents)
            return [];
        return await this.canonicalEvents.query(query);
    }
}
