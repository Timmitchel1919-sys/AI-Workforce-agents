/**
 * EO-4.8 durable ledger for release records (reviews, stage sets, commit and
 * push receipts, pull requests, deployment candidates, releases).
 *
 * - Every record is written to the ExecutionRecordStore (awaited) and cached
 *   in memory; lookups fall back to the store, so records survive restarts
 *   and are visible across Control Plane instances.
 * - Idempotency is a create-only RESERVATION taken before the protected
 *   mutation (commit / push / deploy): two instances handling the same key
 *   can never both mutate; a finished key replays its original result.
 * - Uniqueness markers (e.g. one commit per stage set) are create-only too.
 * Without a store the ledger behaves identically in memory (tests, local).
 */
import { type ExecutionRecordStore } from "../../contracts/index.js";
export declare class DurableLedger {
    private readonly store;
    private readonly clock;
    private readonly caches;
    private readonly reservations;
    constructor(store: ExecutionRecordStore | undefined, clock: () => string);
    private cache;
    /** Persist (awaited) then cache. `create` = immutable evidence. */
    save<T>(kind: string, id: string, projectId: string, createdAt: string, record: T, mode?: "create" | "put"): Promise<T>;
    find<T>(kind: string, id: string): Promise<T | undefined>;
    /** Live + durable records of one project, newest first, bounded. */
    list<T extends {
        projectId: string;
    }>(kind: string, projectId: string, limit: number, idOf: (record: T) => string, dateOf?: (record: T) => string): Promise<T[]>;
    private reservationId;
    /**
     * Take the idempotency reservation for `(scope, actor, key)`. Returns the
     * result id of a finished request (replay), or undefined when the caller
     * now owns the reservation. Throws when another request holds it.
     */
    claim(scope: string, actor: string, key: string, projectId: string): Promise<string | undefined>;
    /** Finish a reservation: `resultId` = done (replayable), none = failed (retryable). */
    settle(scope: string, actor: string, key: string, projectId: string, resultId?: string): Promise<void>;
    /** Create-only uniqueness marker (e.g. one commit per stage set). */
    reserveUnique(kind: string, id: string, projectId: string, message: string): Promise<void>;
}
