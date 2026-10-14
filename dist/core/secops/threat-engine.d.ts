import { SecurityEvent, ThreatRule, SecurityIncident } from "../../contracts/secops.js";
import type { Repository } from "../../contracts/persistence.js";
export interface DurableSecurityIncident extends SecurityIncident {
    id: string;
}
export interface DurableSecurityEvent extends SecurityEvent {
    id: string;
}
export declare class ThreatEngine {
    private readonly incidentRepository?;
    private readonly eventRepository?;
    private events;
    private rules;
    private incidents;
    constructor(incidentRepository?: Repository<DurableSecurityIncident> | undefined, eventRepository?: Repository<DurableSecurityEvent> | undefined);
    registerRule(rule: ThreatRule): void;
    logEvent(event: SecurityEvent): void;
    private evaluateThreats;
    private eventMatchesCondition;
    private createIncident;
    getIncidents(organizationId: string): SecurityIncident[];
    getEvents(organizationId: string): SecurityEvent[];
}
