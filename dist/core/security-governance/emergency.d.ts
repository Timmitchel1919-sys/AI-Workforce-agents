/**
 * Emergency stop — a global, durable brake on AI execution.
 *
 *   NORMAL ──engage──▶ PAUSED ──▶ INVESTIGATING ──▶ RECOVERY_REQUIRED ──resume──▶ NORMAL
 *
 * While not NORMAL no new task, agent action, tool call or deployment is
 * allowed (the governor and the orchestrator both consult `halted()`).
 * Recovery is controlled: only an administrator can resume, only from
 * RECOVERY_REQUIRED, with a written note — never automatically. Engaging is
 * audited and calls the registered handlers (which cancel live sessions).
 */
import type { EmergencyState } from "../../contracts/security-governance.js";
import type { Repository } from "../../contracts/persistence.js";
import type { GovernanceLedger } from "./ledger.js";
export interface EmergencyRecord {
    id: "global";
    state: EmergencyState;
    reason?: string;
    engagedBy?: string;
    engagedAt?: string;
    history: {
        state: EmergencyState | "RESUMED";
        at: string;
        by: string;
        note?: string;
    }[];
}
export declare class EmergencyError extends Error {
    readonly code: "forbidden" | "invalid_state" | "invalid_request";
    constructor(code: "forbidden" | "invalid_state" | "invalid_request", message: string);
}
export declare const HALT_BANNER = "AI WORKFORCE EXECUTION PAUSED";
export declare class EmergencyStop {
    private readonly ledger;
    private readonly clock;
    private readonly repo;
    private readonly handlers;
    constructor(repo: Repository<EmergencyRecord>, ledger: GovernanceLedger, clock: () => string);
    /** Called synchronously when the stop is engaged (cancel live sessions here). */
    onEngage(handler: (record: EmergencyRecord) => void): void;
    get record(): EmergencyRecord;
    get state(): EmergencyState;
    halted(): boolean;
    private save;
    engage(by: string, reason: string): EmergencyRecord;
    advance(by: string, to: "INVESTIGATING" | "RECOVERY_REQUIRED", note?: string): EmergencyRecord;
    resume(by: string, admin: boolean, note: string): EmergencyRecord;
}
