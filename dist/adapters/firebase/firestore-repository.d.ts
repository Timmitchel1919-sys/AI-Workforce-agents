/**
 * `AsyncRepository<T>` backed by a Firestore collection.
 *
 * One document per entity, keyed by `entity.id`. Values are stored as plain
 * JSON (undefined-stripped) — every Workforce entity is already a plain object
 * of strings / numbers / booleans / nested plain objects with ISO-string
 * timestamps, so no custom converters are needed.
 *
 * Bridged to the synchronous `Repository<T>` that core systems consume by
 * `CachedRepository` (hydrate once, write through). See ADR-0011.
 */
import type { AsyncRepository, Entity } from "../../contracts/index.js";
import type { FirestoreCollectionLike, FirestoreLike } from "./firebase-services.js";
export declare class FirestoreRepository<T extends Entity> implements AsyncRepository<T> {
    private readonly collection;
    constructor(collection: FirestoreCollectionLike);
    upsert(entity: T): Promise<void>;
    findById(id: string): Promise<T | undefined>;
    list(): Promise<T[]>;
    delete(id: string): Promise<boolean>;
    clear(): Promise<void>;
}
/** Build a `FirestoreRepository` for a named collection. */
export declare function firestoreRepository<T extends Entity>(firestore: FirestoreLike, collectionPath: string): FirestoreRepository<T>;
