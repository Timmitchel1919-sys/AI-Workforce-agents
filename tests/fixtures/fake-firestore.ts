/**
 * In-memory Firestore TEST DOUBLE with the subset the adapters use: documents,
 * equality queries, and serializable transactions (reads first, staged
 * writes applied atomically on success, `create` failing with gRPC code 6
 * ALREADY_EXISTS). Never used outside tests; never touches a real project.
 */
import type {
  FirestoreDocRefLike,
  FirestoreDocSnapshotLike,
  FirestoreQueryableCollectionLike,
  FirestoreQueryLike,
  FirestoreTransactionLike,
  TransactionalFirestoreLike,
} from "../../adapters/index.js";

type Doc = Record<string, unknown>;

interface FakeRef extends FirestoreDocRefLike {
  readonly collection: FakeCollection;
  readonly id: string;
}

export class FakeCollection implements FirestoreQueryableCollectionLike {
  readonly values = new Map<string, Doc>();

  doc(id: string): FakeRef {
    return {
      collection: this,
      id,
      set: async (value) => void this.values.set(id, structuredClone(value)),
      get: async () => this.snapshot(id),
      delete: async () => void this.values.delete(id),
    };
  }

  snapshot(id: string): FirestoreDocSnapshotLike {
    const value = this.values.get(id);
    return {
      exists: value !== undefined,
      data: () => (value ? structuredClone(value) : undefined),
    };
  }

  async get() {
    return {
      docs: [...this.values.entries()].map(([id, value]) => ({
        id,
        data: () => structuredClone(value),
      })),
    };
  }

  where(field: string, _op: "==", value: string): FirestoreQueryLike {
    return {
      get: async () => ({
        docs: [...this.values.entries()]
          .filter(([, doc]) => doc[field] === value)
          .map(([id, doc]) => ({ id, data: () => structuredClone(doc) })),
      }),
    };
  }

  async listDocuments() {
    return [...this.values.keys()].map((id) => this.doc(id));
  }
}

export class FakeFirestore implements TransactionalFirestoreLike {
  private readonly collections = new Map<string, FakeCollection>();
  private lock: Promise<void> = Promise.resolve();
  transactions = 0;

  collection(path: string): FakeCollection {
    let collection = this.collections.get(path);
    if (!collection) {
      collection = new FakeCollection();
      this.collections.set(path, collection);
    }
    return collection;
  }

  /** Serializable: one transaction at a time, writes applied on success. */
  async runTransaction<T>(
    fn: (transaction: FirestoreTransactionLike) => Promise<T>,
  ): Promise<T> {
    const run = this.lock.then(async () => {
      this.transactions += 1;
      const writes: { ref: FakeRef; data: Doc; create: boolean }[] = [];
      const tx: FirestoreTransactionLike = {
        get: async (ref) =>
          (ref as FakeRef).collection.snapshot((ref as FakeRef).id),
        create: (ref, data) =>
          void writes.push({ ref: ref as FakeRef, data, create: true }),
        set: (ref, data) =>
          void writes.push({ ref: ref as FakeRef, data, create: false }),
      };
      const result = await fn(tx);
      for (const w of writes) {
        if (w.create && w.ref.collection.values.has(w.ref.id)) {
          throw Object.assign(new Error("already exists"), { code: 6 });
        }
      }
      for (const w of writes) {
        w.ref.collection.values.set(w.ref.id, structuredClone(w.data));
      }
      return result;
    });
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
