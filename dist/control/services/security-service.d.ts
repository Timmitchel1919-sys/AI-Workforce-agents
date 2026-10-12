import type { Repository } from "../../contracts/persistence.js";
import { type OperatorPrincipal } from "../../contracts/control.js";
import type { ZTNSecurityEvent, ZeroTrustPolicy, ThreatIntelligenceReport } from "../../contracts/security.js";
import type { CanonicalSecurityEvent, AsyncSecurityEventStore, SecurityEventQuery } from "../../contracts/security-event.js";
import type { SecurityEventStore } from "../../core/security/security-event-store.js";
export declare class SecurityControlService {
    private readonly events;
    private readonly policies;
    private readonly threatIntel;
    private readonly canonicalEvents?;
    constructor(events: Repository<ZTNSecurityEvent>, policies: Repository<ZeroTrustPolicy>, threatIntel: Repository<ThreatIntelligenceReport>, canonicalEvents?: (SecurityEventStore | AsyncSecurityEventStore) | undefined);
    /**
     * Deny-by-default authorization. Each security action maps to a specific
     * {@link ControlCapability}; the role → capability table lives in
     * `contracts/control.ts`. Unknown capabilities never silently pass.
     */
    private requireCapability;
    /**
     * Legacy ZTN event listing. Reading detailed event evidence is a security
     * capability (not an admin-role check): operators with `view_security_events`
     * may read, viewers may not. Mutation of events is handled server-side by
     * `logEvent`, not through this method.
     */
    listEvents(operator: OperatorPrincipal): Promise<ZTNSecurityEvent[]>;
    logEvent(event: Omit<ZTNSecurityEvent, "id" | "eventId" | "status" | "createdAt">): Promise<ZTNSecurityEvent>;
    /**
     * Reading policy POSTURE (what is in force) is a read capability
     * (`view_security`). Mutating policy is a separate capability
     * (`manage_security_policy`) and is NOT exposed by this method.
     */
    listPolicies(operator: OperatorPrincipal): Promise<ZeroTrustPolicy[]>;
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
    listCanonicalEvents(operator: OperatorPrincipal, query?: SecurityEventQuery): Promise<CanonicalSecurityEvent[]>;
}
