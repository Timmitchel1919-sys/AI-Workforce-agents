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
import { type ExecutionReceipt } from "../../contracts/index.js";
import type { ExecutionReceiptStore } from "../../core/execution/execution-receipts.js";
import type { TransactionalFirestoreLike } from "./firebase-services.js";
export declare const EXECUTION_RECEIPTS_COLLECTION = "execution_receipts";
export interface FirestoreExecutionReceiptStoreOptions {
    readonly collectionPrefix?: string;
    readonly onError?: (error: unknown, context: {
        receiptId: string;
    }) => void;
}
export declare class FirestoreExecutionReceiptStore implements ExecutionReceiptStore {
    private readonly firestore;
    private readonly collection;
    private readonly receipts;
    private readonly pending;
    private readonly onError;
    readonly ready: Promise<void>;
    constructor(firestore: TransactionalFirestoreLike, options?: FirestoreExecutionReceiptStoreOptions);
    private load;
    record(receipt: ExecutionReceipt): ExecutionReceipt;
    get(receiptId: string): ExecutionReceipt | undefined;
    forSession(sessionId: string): ExecutionReceipt[];
    flush(): Promise<void>;
    private enqueueWrite;
}
