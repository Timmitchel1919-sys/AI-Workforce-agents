import type { AuditLog } from "../audit/audit-log.js";
import type { Repository } from "../../contracts/persistence.js";
import type { AlertSeverity, LedgerEntry } from "../../contracts/security-governance.js";
export declare class LedgerTamperError extends Error {
    constructor(message: string);
}
/** Repository that only ever appends. */
export declare class AppendOnlyRepository<T extends {
    id: string;
}> implements Repository<T> {
    private readonly inner;
    constructor(repo: Repository<T>);
    upsert(entity: T): void;
    findById(id: string): T | undefined;
    list(): T[];
    delete(): boolean;
    clear(): void;
}
export interface LedgerFields {
    actor: string;
    severity?: AlertSeverity;
    projectId?: string | undefined;
    agentId?: string | undefined;
    taskId?: string | undefined;
    executionId?: string | undefined;
    toolId?: string | undefined;
    action?: string | undefined;
    resource?: string | undefined;
    risk?: string | undefined;
    policyIds?: string[] | undefined;
    result: string;
    detail?: Record<string, unknown>;
}
export declare class GovernanceLedger {
    private readonly audit;
    private readonly clock;
    private readonly repo;
    private seq;
    private lastHash;
    constructor(repo: Repository<LedgerEntry>, audit: AuditLog | undefined, clock: () => string);
    private sorted;
    record(operation: string, f: LedgerFields): LedgerEntry;
    all(): readonly LedgerEntry[];
    query(filter: {
        projectId?: string;
        agentId?: string;
        taskId?: string;
        toolId?: string;
        action?: string;
        risk?: string;
        policyId?: string;
        result?: string;
        operation?: string;
        since?: string;
        until?: string;
        limit?: number;
    }): LedgerEntry[];
    /** Recompute the chain. `ok:false` names the first record that does not verify. */
    verify(): {
        ok: boolean;
        entries: number;
        brokenAt?: number;
    };
}
