import { SecurityEvent, ThreatRule, SecurityIncident } from "../../contracts/secops.js";
export declare class ThreatEngine {
    private events;
    private rules;
    private incidents;
    registerRule(rule: ThreatRule): void;
    logEvent(event: SecurityEvent): void;
    private evaluateThreats;
    private eventMatchesCondition;
    private createIncident;
    getIncidents(organizationId: string): SecurityIncident[];
    getEvents(organizationId: string): SecurityEvent[];
}
