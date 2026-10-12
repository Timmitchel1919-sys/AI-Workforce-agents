import { type AlertSeverity, type AlertStatus, type SecurityAlert } from "../../contracts/security-governance.js";
import type { Repository } from "../../contracts/persistence.js";
import type { GovernanceLedger } from "./ledger.js";
export declare class AlertError extends Error {
    readonly code: "invalid_state" | "forbidden" | "not_found" | "invalid_request";
    constructor(code: "invalid_state" | "forbidden" | "not_found" | "invalid_request", message: string);
}
export declare const severityRank: (s: AlertSeverity) => number;
export interface RaiseInput {
    severity: AlertSeverity;
    source: SecurityAlert["source"];
    event: string;
    description: string;
    projectId?: string | undefined;
    executionId?: string | undefined;
    taskId?: string | undefined;
    agentId?: string | undefined;
    evidence?: Record<string, unknown>;
    /** Alerts with the same key merge while one is still open. */
    dedupeKey?: string;
}
export declare class SecurityAlertService {
    private readonly ledger;
    private readonly clock;
    private readonly onRaised?;
    private readonly repo;
    constructor(repo: Repository<SecurityAlert>, ledger: GovernanceLedger, clock: () => string, onRaised?: ((alert: SecurityAlert) => void) | undefined);
    private evidence;
    raise(input: RaiseInput): SecurityAlert;
    get(alertId: string): SecurityAlert | undefined;
    list(filter?: {
        status?: AlertStatus[];
        severity?: AlertSeverity[];
        projectId?: string;
        agentId?: string;
        openOnly?: boolean;
    }): SecurityAlert[];
    transition(alertId: string, to: AlertStatus, by: string, opts: {
        admin: boolean;
        note?: string;
    }): SecurityAlert;
}
export interface ThreatSignal {
    at: number;
    agentId?: string;
    projectId?: string;
    taskId?: string;
    executionId?: string;
    kind: "DENIED" | "SECRET_ACCESS" | "DESTRUCTIVE_REQUEST" | "SENSITIVE_READ" | "BLOCKED_COMMAND" | "PRIVILEGE_ESCALATION" | "SCOPE_VIOLATION";
    resource?: string;
}
export interface ThreatResponse {
    suspend?: {
        agentId: string;
        reason: string;
    };
    reviewRequired?: {
        agentId: string;
        reason: string;
    };
}
export declare class ThreatDetector {
    private readonly alerts;
    private readonly windowMs;
    private readonly signals;
    constructor(alerts: SecurityAlertService, windowMs?: number);
    ingest(signal: ThreatSignal): ThreatResponse;
}
