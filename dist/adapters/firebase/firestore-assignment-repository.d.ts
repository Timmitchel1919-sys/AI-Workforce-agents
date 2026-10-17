/**
 * Durable `AssignmentRepository` backed by Firestore (R1 — Persistent
 * Execution Foundation).
 *
 * Design: write-through in-memory cache fronting a Firestore collection.
 *
 *   - On construction, `load()` fetches every existing assignment into the
 *     cache. Callers must `await repo.ready` before relying on reads.
 *   - `upsert()` is SYNCHRONOUS at the call site (the sync interface the
 *     `SpecialistAssignmentService` has always expected): it updates the
 *     cache and enqueues a Firestore write. The background write runs
 *     fire-and-forget with the supplied `onError` hook.
 *   - `flush()` awaits all pending Firestore writes — call this at HTTP
 *     response boundaries to guarantee durability before replying.
 *
 * Why not pure async: `SpecialistAssignmentService` and all of its callers
 * are synchronous. Making them async is a cross-cutting change outside R1's
 * scope. The write-through cache preserves the sync contract while giving
 * every write a durable mirror; cold starts rebuild the cache from
 * Firestore. The only sharp corner is a crash between the sync upsert and
 * the enqueued write landing — a sub-ms window on a single-instance
 * function. The `flush()` barrier eliminates even that when it is called.
 */
import type { Assignment } from "../../contracts/index.js";
import type { AssignmentRepository } from "../../core/orchestrator/assignment-system.js";
import type { TransactionalFirestoreLike } from "./firebase-services.js";
export declare const ASSIGNMENTS_COLLECTION = "assignments";
export interface FirestoreAssignmentRepositoryOptions {
    readonly collectionPrefix?: string;
    /** Invoked when a background Firestore write fails. */
    readonly onError?: (error: unknown, context: {
        assignmentId: string;
    }) => void;
}
export declare class FirestoreAssignmentRepository implements AssignmentRepository {
    private readonly collection;
    private readonly items;
    private readonly pending;
    private readonly onError;
    readonly ready: Promise<void>;
    constructor(firestore: TransactionalFirestoreLike, options?: FirestoreAssignmentRepositoryOptions);
    private load;
    list(): Assignment[];
    findById(id: string): Assignment | undefined;
    upsert(item: Assignment): void;
    currentForTask(taskId: string): Assignment | undefined;
    historyForTask(taskId: string): Assignment[];
    /** Await every outstanding background write; call at response boundaries. */
    flush(): Promise<void>;
    private enqueueWrite;
}
