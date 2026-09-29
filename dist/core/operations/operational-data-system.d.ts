import { type AuditEvent, type AuditSink, type DataReadinessAssessment, type DataReadinessRequest, type OperationalEvent, type OperationalOutcome, type Repository } from "../../contracts/index.js";
export interface OperationalDataSystemDeps {
    events: Repository<OperationalEvent>;
    outcomes: Repository<OperationalOutcome>;
    clock?: () => string;
}
/**
 * Append-only operational facts and outcomes. The system deliberately does
 * not produce forecasts; consumers must first ask `assessReadiness`.
 */
export declare class OperationalDataSystem {
    private readonly deps;
    private readonly clock;
    constructor(deps: OperationalDataSystemDeps);
    recordEvent(event: OperationalEvent): OperationalEvent;
    recordOutcome(outcome: OperationalOutcome): OperationalOutcome;
    eventsForProject(projectId: string): OperationalEvent[];
    outcomesForProject(projectId: string): OperationalOutcome[];
    assessReadiness(request: DataReadinessRequest): DataReadinessAssessment;
}
/**
 * Translates existing audit records into redacted operational observations.
 * Audit remains authoritative; this sink never turns an observation into a
 * prediction and ignores records without a project boundary.
 */
export declare class OperationalAuditSink implements AuditSink {
    private readonly data;
    constructor(data: OperationalDataSystem);
    write(event: AuditEvent): void;
}
