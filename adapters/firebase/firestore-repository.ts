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
import type {
  FirestoreCollectionLike,
  FirestoreLike,
} from "./firebase-services.js";

function plain<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export class FirestoreRepository<
  T extends Entity,
> implements AsyncRepository<T> {
  constructor(private readonly collection: FirestoreCollectionLike) {}

  async upsert(entity: T): Promise<void> {
    await this.collection.doc(entity.id).set(plain(entity));
  }

  async findById(id: string): Promise<T | undefined> {
    const snap = await this.collection.doc(id).get();
    if (!snap.exists) return undefined;
    const data = snap.data();
    return data ? (structuredClone(data) as T) : undefined;
  }

  async list(): Promise<T[]> {
    const snap = await this.collection.get();
    return snap.docs.map((doc) => structuredClone(doc.data()) as T);
  }

  async delete(id: string): Promise<boolean> {
    const ref = this.collection.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }

  async clear(): Promise<void> {
    const docs = await this.collection.listDocuments();
    await Promise.all(docs.map((doc) => doc.delete()));
  }
}

/** Build a `FirestoreRepository` for a named collection. */
export function firestoreRepository<T extends Entity>(
  firestore: FirestoreLike,
  collectionPath: string,
): FirestoreRepository<T> {
  const collection: FirestoreCollectionLike =
    firestore.collection(collectionPath);
  return new FirestoreRepository<T>(collection);
}
