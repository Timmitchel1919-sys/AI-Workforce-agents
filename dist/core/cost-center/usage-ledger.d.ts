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
    /**
     * Coalesces concurrent `record()` calls for the SAME idempotency key onto
     * ONE write, within this process. This is what makes idempotency actually
     * safe under concurrency for the no-store (in-memory) composition too: the
     * store-backed path also gets `RecordExistsError` protection from
     * `DurableLedger`/Firestore, but the in-memory fallback has none of its
     * own — two truly concurrent callers there would otherwise both "win" and
     * whichever write lands last would silently overwrite the other's content
     * with no error to catch. Reserving the SAME in-flight promise, set
     * synchronously before any `await`, closes that gap without needing the
     * shared `DurableLedger` primitive itself to change.
     */
    private readonly inFlight;
    constructor(store: ExecutionRecordStore | undefined, clock: () => string);
    /**
     * Internal recording path — called only by the governed provider decorator
     * right after a real response is received, never from an operator request.
     * Not authorized against a principal for that reason.
     *
     * IDEMPOTENT when the caller supplies `idempotencyKey`: a retried call with
     * the SAME key for the SAME distinct request returns the FIRST record
     * unchanged rather than creating a second one (prevents double-charging a
     * project for one retried provider call). Safe under concurrency: the
     * store-backed path relies on create-only semantics, so two instances
     * racing on the same key can never both win — the loser re-reads and
     * returns what the winner wrote. With no key, no dedupe is possible; every
     * call records a new entry.
     *
     * A caller is expected to generate a key that is unique PER DISTINCT
     * request (like any idempotency key — reusing one across genuinely
     * different requests means only the first is ever recorded, by design, the
     * same as it would be anywhere else this pattern is used).
     *
     * The key is validated (`requireExecutionId`) and joined with `\u0000` —
     * never with `:`, which `projectId` may legally contain — so a colon in
     * one project's id can never be mistaken for the id/key boundary and
     * collide with a different project's record (e.g. project `"acme"` with
     * key `"eu:x"` must never produce the same storage id as project
     * `"acme:eu"` with key `"x"`).
     */
    record(draft: UsageDraft): Promise<UsageRecord>;
    private persist;
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
