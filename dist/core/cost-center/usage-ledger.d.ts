/**
 * EO-6.2 — durable, project-scoped model-usage ledger.
 *
 * Every entry is written only from a real provider response's own reported
 * usage (never assumed), through the DurableLedger (survives restarts,
 * visible across Control Plane instances — same primitive EO-4.8 uses for
 * release records).
 */
import { type ExecutionRecordStore, type OperatorPrincipal, type UsageDraft, type UsageRecord } from "../../contracts/index.js";
export declare class UsageLedger {
    private readonly clock;
    private readonly ledger;
    constructor(store: ExecutionRecordStore | undefined, clock: () => string);
    /**
     * Internal recording path — called only by the governed provider decorator
     * right after a real response is received, never from an operator request.
     * Not authorized against a principal for that reason.
     */
    record(draft: UsageDraft): Promise<UsageRecord>;
    listByProject(principal: OperatorPrincipal, projectId: string, limit?: number): Promise<UsageRecord[]>;
    /**
     * Totals in USD over the given windows, plus how many usage events could
     * not be priced (so a caller never silently treats "unpriced" as "free").
     * `since` bounds are inclusive ISO timestamps; a window with no bound
     * (e.g. "task" scoped by taskId, not time) is filtered by predicate instead.
     */
    totals(principal: OperatorPrincipal, projectId: string, windows: {
        dailySinceIso: string;
        monthlySinceIso: string;
        taskId?: string;
    }): Promise<{
        daily: number;
        monthly: number;
        task: number;
        uncosted: number;
    }>;
    /**
     * No principal: the trusted internal gate a model call runs through before
     * it is made is not an operator viewing a project, so it never needs (or
     * fabricates) an operator identity to read the usage it enforces against.
     */
    listInternal(projectId: string, limit?: number): Promise<UsageRecord[]>;
    totalsInternal(projectId: string, windows: {
        dailySinceIso: string;
        monthlySinceIso: string;
        taskId?: string;
    }): Promise<{
        daily: number;
        monthly: number;
        task: number;
        uncosted: number;
    }>;
    private authorize;
}
