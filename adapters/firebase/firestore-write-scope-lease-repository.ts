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
import type {
  FirestoreQueryableCollectionLike,
  TransactionalFirestoreLike,
} from "./firebase-services.js";

export const WRITE_SCOPE_LEASES_COLLECTION = "write_scope_leases";

export interface FirestoreWriteScopeLeaseRepositoryOptions {
  readonly collectionPrefix?: string;
  readonly onError?: (error: unknown, context: { leaseId: string }) => void;
}

export class FirestoreWriteScopeLeaseRepository implements LeaseRepository<WriteScopeLease> {
  private readonly collection: FirestoreQueryableCollectionLike;
  private readonly items = new Map<string, WriteScopeLease>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly onError: (
    error: unknown,
    context: { leaseId: string },
  ) => void;
  readonly ready: Promise<void>;

  constructor(
    firestore: TransactionalFirestoreLike,
    options: FirestoreWriteScopeLeaseRepositoryOptions = {},
  ) {
    this.collection = firestore.collection(
      (options.collectionPrefix ?? "") + WRITE_SCOPE_LEASES_COLLECTION,
    );
    this.onError =
      options.onError ??
      ((error, { leaseId }) => {
        console.error(
          `[FirestoreWriteScopeLeaseRepository] background write failed for ${leaseId}:`,
          error,
        );
      });
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const snapshot = await this.collection.get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data && typeof data.leaseId === "string") {
        this.items.set(data.leaseId, data as unknown as WriteScopeLease);
      }
    }
  }

  list(): WriteScopeLease[] {
    return [...this.items.values()];
  }

  findById(id: string): WriteScopeLease | undefined {
    return this.items.get(id);
  }

  upsert(item: WriteScopeLease): void {
    this.items.set(item.leaseId, item);
    this.enqueueWrite(item);
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  private enqueueWrite(item: WriteScopeLease): void {
    const payload = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    const promise = this.collection
      .doc(item.leaseId)
      .set(payload)
      .catch((error: unknown) => {
        this.onError(error, { leaseId: item.leaseId });
      })
      .finally(() => {
        this.pending.delete(promise);
      });
    this.pending.add(promise);
  }
}
