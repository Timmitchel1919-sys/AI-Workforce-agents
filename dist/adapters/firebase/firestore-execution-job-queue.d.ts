/**
 * Firestore-backed `ExecutionJobQueue` (R2).
 *
 * Durable storage: one Firestore collection `execution_jobs` keyed by
 * `jobId`. Transactions are the only path that mutates job state so a
 * single worker owns the lease at all times.
 *
 * `acquire()` sweeps leases that have expired (worker crash) before
 * selecting the oldest `queued` job whose `availableAt` has arrived; the
 * selection + state transition + lease write all happen inside one
 * transaction.
 */
import { type ExecutionJob } from "../../contracts/index.js";
import type { AcquireExecutionJobInput, CompleteExecutionJobInput, EnqueueExecutionJobInput, ExecutionJobQueue, HeartbeatExecutionJobInput } from "../../core/execution/execution-job-queue.js";
import type { TransactionalFirestoreLike } from "./firebase-services.js";
export declare const EXECUTION_JOBS_COLLECTION = "execution_jobs";
export interface FirestoreExecutionJobQueueOptions {
    readonly collectionPrefix?: string;
    readonly clock?: () => Date;
    /** Max jobs to consider per acquire call. Default 25. */
    readonly scanLimit?: number;
}
export declare class FirestoreExecutionJobQueue implements ExecutionJobQueue {
    private readonly firestore;
    private readonly collection;
    private readonly clock;
    private readonly scanLimit;
    constructor(firestore: TransactionalFirestoreLike, options?: FirestoreExecutionJobQueueOptions);
    enqueue(input: EnqueueExecutionJobInput): Promise<void>;
    acquire(input: AcquireExecutionJobInput): Promise<ExecutionJob | undefined>;
    heartbeat(input: HeartbeatExecutionJobInput): Promise<void>;
    complete(input: CompleteExecutionJobInput): Promise<void>;
    requestCancellation(jobId: string, reason: string): Promise<void>;
    get(jobId: string): Promise<ExecutionJob | undefined>;
    findByIdempotencyKey(key: string): Promise<ExecutionJob | undefined>;
    private tryClaim;
    private sweepExpired;
    private serialize;
}
