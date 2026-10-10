import type { Repository } from "../../contracts/persistence.js";
import type { ZTNSecurityEvent, ZeroTrustPolicy, ThreatIntelligenceReport } from "../../contracts/security.js";
export declare class SecurityControlService {
    private readonly events;
    private readonly policies;
    private readonly threatIntel;
    constructor(events: Repository<ZTNSecurityEvent>, policies: Repository<ZeroTrustPolicy>, threatIntel: Repository<ThreatIntelligenceReport>);
    private enforceAdmin;
    listEvents(): Promise<ZTNSecurityEvent[]>;
    logEvent(event: Omit<ZTNSecurityEvent, "id" | "eventId" | "status" | "createdAt">): Promise<ZTNSecurityEvent>;
    listPolicies(): Promise<ZeroTrustPolicy[]>;
}
