/**
 * Composition helper: Firestore-backed, hydrate-once, write-through
 * `Repository<T>` instances for the control plane and the durable domain
 * collections.
 *
 *   Firestore collection → FirestoreRepository (AsyncRepository) → CachedRepository (sync Repository)
 *
 * The returned repositories drop straight into the existing constructors
 * (`AuditLog(sink, repo)`, `new AgentOperationalStore(repo)`, …) with no change
 * to `core/` or `control/`. Call `hydrateAll()` once before serving traffic and
 * `flushAll()` on shutdown. See ADR-0011.
 */
import type { Entity } from "../contracts/index.js";
import { type FirestoreLike } from "../adapters/firebase/index.js";
import { CachedRepository, type CachedRepositoryOptions } from "../core/index.js";
export interface FirebaseRepositoryProviderOptions {
    /** Prefix applied to every collection path (e.g. an environment namespace). */
    collectionPrefix?: string;
    /** Reported when a background write to Firestore fails. */
    onWriteError?: CachedRepositoryOptions["onError"];
}
export declare class FirebaseRepositoryProvider {
    private readonly firestore;
    private readonly repos;
    private readonly prefix;
    private readonly onError;
    constructor(firestore: FirestoreLike, options?: FirebaseRepositoryProviderOptions);
    /** A cached repository for a Firestore collection. Same instance per path. */
    repository<T extends Entity>(collectionPath: string): CachedRepository<T>;
    /** Hydrate every repository created so far. Await before serving traffic. */
    hydrateAll(): Promise<void>;
    /** Await every pending background write. Call on graceful shutdown. */
    flushAll(): Promise<void>;
    get pendingWrites(): number;
}
