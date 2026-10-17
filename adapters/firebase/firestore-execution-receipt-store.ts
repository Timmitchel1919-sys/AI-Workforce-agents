/**
 * Durable `ExecutionReceiptStore` backed by Firestore (R1).
 *
 * Receipts are append-only. The sync `record()` must reject any duplicate
 * `receiptId` with the same `ValidationError` message the in-memory store
 * raises so callers see identical semantics. We therefore:
 *
 *   1. Keep an in-memory cache of all receipts (loaded on `.ready`).
 *   2. Enforce the "already exists" check SYNCHRONOUSLY against that cache
 *      before any Firestore round-trip.
 *   3. Persist each new receipt with `transaction.create()`, which fails
 *      closed if a concurrent writer wrote the same id (defence in depth
 *      against future multi-instance topologies).
 *
 * The background Firestore write is enqueued and awaitable via `.flush()`.
 */
import {
  ValidationError,
  type ExecutionReceipt,
} from "../../contracts/index.js";
import type { ExecutionReceiptStore } from "../../core/execution/execution-receipts.js";
import type {
  FirestoreQueryableCollectionLike,
  TransactionalFirestoreLike,
} from "./firebase-services.js";

export const EXECUTION_RECEIPTS_COLLECTION = "execution_receipts";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

export interface FirestoreExecutionReceiptStoreOptions {
  readonly collectionPrefix?: string;
  readonly onError?: (error: unknown, context: { receiptId: string }) => void;
}

export class FirestoreExecutionReceiptStore implements ExecutionReceiptStore {
  private readonly firestore: TransactionalFirestoreLike;
  private readonly collection: FirestoreQueryableCollectionLike;
  private readonly receipts = new Map<string, ExecutionReceipt>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly onError: (
    error: unknown,
    context: { receiptId: string },
  ) => void;
  readonly ready: Promise<void>;

  constructor(
    firestore: TransactionalFirestoreLike,
    options: FirestoreExecutionReceiptStoreOptions = {},
  ) {
    this.firestore = firestore;
    this.collection = firestore.collection(
      (options.collectionPrefix ?? "") + EXECUTION_RECEIPTS_COLLECTION,
    );
    this.onError =
      options.onError ??
      ((error, { receiptId }) => {
        console.error(
          `[FirestoreExecutionReceiptStore] background write failed for ${receiptId}:`,
          error,
        );
      });
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const snapshot = await this.collection.get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data && typeof data.receiptId === "string") {
        this.receipts.set(
          data.receiptId,
          deepFreeze(data as unknown as ExecutionReceipt),
        );
      }
    }
  }

  record(receipt: ExecutionReceipt): ExecutionReceipt {
    if (this.receipts.has(receipt.receiptId)) {
      throw new ValidationError(
        `receipt ${receipt.receiptId} already exists; receipts are immutable`,
      );
    }
    const frozen = deepFreeze(structuredClone(receipt));
    this.receipts.set(receipt.receiptId, frozen);
    this.enqueueWrite(frozen);
    return frozen;
  }

  get(receiptId: string): ExecutionReceipt | undefined {
    return this.receipts.get(receiptId);
  }

  forSession(sessionId: string): ExecutionReceipt[] {
    return [...this.receipts.values()].filter((r) => r.sessionId === sessionId);
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  private enqueueWrite(receipt: ExecutionReceipt): void {
    const payload = JSON.parse(JSON.stringify(receipt)) as Record<
      string,
      unknown
    >;
    const ref = this.collection.doc(receipt.receiptId);
    const promise = this.firestore
      .runTransaction(async (transaction) => {
        transaction.create(ref, payload);
      })
      .catch((error: unknown) => {
        this.onError(error, { receiptId: receipt.receiptId });
      })
      .finally(() => {
        this.pending.delete(promise);
      });
    this.pending.add(promise);
  }
}
