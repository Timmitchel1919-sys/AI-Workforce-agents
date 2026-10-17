/**
 * Durable `LeaseRepository<WriteScopeLease>` backed by Firestore (R1).
 *
 * Same write-through cache pattern as `FirestoreAssignmentRepository`:
 *
 *   - Callers must await `.ready` before relying on reads.
 *   - `upsert()` updates the cache synchronously and enqueues a background
 *     Firestore write.
 *   - `.flush()` awaits all pending writes; use at response boundaries.
 *
 * See `firestore-assignment-repository.ts` for the full rationale.
 */
import type { WriteScopeLease } from "../../contracts/index.js";
import type { LeaseRepository } from "../../core/orchestrator/lease-manager.js";
import type { TransactionalFirestoreLike } from "./firebase-services.js";
export declare const WRITE_SCOPE_LEASES_COLLECTION = "write_scope_leases";
export interface FirestoreWriteScopeLeaseRepositoryOptions {
    readonly collectionPrefix?: string;
    readonly onError?: (error: unknown, context: {
        leaseId: string;
    }) => void;
}
export declare class FirestoreWriteScopeLeaseRepository implements LeaseRepository<WriteScopeLease> {
    private readonly collection;
    private readonly items;
    private readonly pending;
    private readonly onError;
    readonly ready: Promise<void>;
    constructor(firestore: TransactionalFirestoreLike, options?: FirestoreWriteScopeLeaseRepositoryOptions);
    private load;
    list(): WriteScopeLease[];
    findById(id: string): WriteScopeLease | undefined;
    upsert(item: WriteScopeLease): void;
    flush(): Promise<void>;
    private enqueueWrite;
}
