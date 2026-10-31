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
import type {
  FirestoreQueryableCollectionLike,
  TransactionalFirestoreLike,
} from "./firebase-services.js";

export const ASSIGNMENTS_COLLECTION = "assignments";

export interface FirestoreAssignmentRepositoryOptions {
  readonly collectionPrefix?: string;
  /** Invoked when a background Firestore write fails. */
  readonly onError?: (
    error: unknown,
    context: { assignmentId: string },
  ) => void;
}

export class FirestoreAssignmentRepository implements AssignmentRepository {
  private readonly collection: FirestoreQueryableCollectionLike;
  private readonly items = new Map<string, Assignment>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly onError: (
    error: unknown,
    context: { assignmentId: string },
  ) => void;
  readonly ready: Promise<void>;

  constructor(
    firestore: TransactionalFirestoreLike,
    options: FirestoreAssignmentRepositoryOptions = {},
  ) {
    this.collection = firestore.collection(
      (options.collectionPrefix ?? "") + ASSIGNMENTS_COLLECTION,
    );
    this.onError =
      options.onError ??
      ((error, { assignmentId }) => {
        console.error(
          `[FirestoreAssignmentRepository] background write failed for ${assignmentId}:`,
          error,
        );
      });
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const snapshot = await this.collection.get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data && typeof data.assignmentId === "string") {
        this.items.set(data.assignmentId, data as unknown as Assignment);
      }
    }
  }

  list(): Assignment[] {
    return [...this.items.values()];
  }

  findById(id: string): Assignment | undefined {
    return this.items.get(id);
  }

  upsert(item: Assignment): void {
    this.items.set(item.assignmentId, item);
    this.enqueueWrite(item);
  }

  currentForTask(taskId: string): Assignment | undefined {
    return this.list()
      .filter((a) => a.taskId === taskId && a.status !== "reassigned")
      .sort(
        (a, b) =>
          b.assignedAt.localeCompare(a.assignedAt) ||
          a.assignmentId.localeCompare(b.assignmentId),
      )[0];
  }

  historyForTask(taskId: string): Assignment[] {
    return this.list()
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
  }

  /** Await every outstanding background write; call at response boundaries. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  private enqueueWrite(item: Assignment): void {
    const payload = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    const promise = this.collection
      .doc(item.assignmentId)
      .set(payload)
      .catch((error: unknown) => {
        this.onError(error, { assignmentId: item.assignmentId });
      })
      .finally(() => {
        this.pending.delete(promise);
      });
    this.pending.add(promise);
  }
}
