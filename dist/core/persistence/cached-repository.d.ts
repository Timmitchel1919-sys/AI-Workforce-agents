import type { AsyncRepository, Entity, Repository } from "../../contracts/index.js";
/**
 * Bridges an {@link AsyncRepository} (a networked store — Firestore, SQL, an
 * HTTP API) to the synchronous {@link Repository} contract every core system is
 * built on, so the deterministic core lifecycle is never made async.
 *
 *   hydrate once  →  serve every read from memory  →  write through in order
 *
 * `hydrate()` must be awaited during wiring, before the repository is handed to
 * a core system. After that, reads are synchronous and local; writes update the
 * in-memory copy immediately and are flushed to the backing store on a
 * serialized queue. A backing-store write failure is reported through `onError`
 * (it does not throw into the caller, which has already observed the write
 * locally); `flush()` awaits the queue for graceful shutdown.
 *
 * Consistency: single-writer. One process owns the cache; concurrent writers to
 * the same backing store would drift. That is acceptable for the current
 * single-instance control API and is documented in ADR-0011.
 */
export interface CachedRepositoryOptions {
    /** Invoked when a write to the backing store fails. Defaults to a no-op. */
    onError?: (operation: "upsert" | "delete" | "clear", error: unknown) => void;
}
export declare class CachedRepository<T extends Entity> implements Repository<T> {
    private readonly backing;
    private readonly cache;
    private readonly onError;
    private hydrated;
    private queue;
    private pending;
    constructor(backing: AsyncRepository<T>, options?: CachedRepositoryOptions);
    /** Load the full backing collection into memory. Await before first use. */
    hydrate(): Promise<this>;
    /** Number of backing-store writes not yet acknowledged. */
    get pendingWrites(): number;
    /** Resolve once every queued backing-store write has settled. */
    flush(): Promise<void>;
    upsert(entity: T): void;
    findById(id: string): T | undefined;
    list(): T[];
    delete(id: string): boolean;
    clear(): void;
    private assertHydrated;
    private enqueue;
}
