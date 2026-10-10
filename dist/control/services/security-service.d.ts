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
    private enforceAdmin;
    listEvents(operator: OperatorPrincipal): Promise<ZTNSecurityEvent[]>;
    logEvent(event: Omit<ZTNSecurityEvent, "id" | "eventId" | "status" | "createdAt">): Promise<ZTNSecurityEvent>;
    listPolicies(operator: OperatorPrincipal): Promise<ZeroTrustPolicy[]>;
    listCanonicalEvents(operator: OperatorPrincipal, query?: SecurityEventQuery): Promise<CanonicalSecurityEvent[]>;
}
