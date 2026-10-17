/**
 * Durable execution-job queue port (R2).
 *
 * The Control Plane enqueues a job; a worker (Cloud Run service in
 * production, in-process in tests) acquires exclusive ownership atomically
 * and reports completion. Durable state lives in Firestore; this port
 * abstracts the backing store so the same worker loop runs against the
 * Firestore adapter in production and a Fake adapter in unit tests.
 */
import type { ExecutionJob, ExecutionJobStatus } from "../../contracts/index.js";
export interface EnqueueExecutionJobInput {
    readonly job: ExecutionJob;
}
export interface AcquireExecutionJobInput {
    readonly workerId: string;
    /** How long the worker is allowed to hold the lease before auto-expiry. */
    readonly leaseTtlMs: number;
    /** Optional project filter — allows per-project workers. */
    readonly projectId?: string;
    /** Current wall-clock time, injectable for tests. */
    readonly now?: Date;
}
export interface CompleteExecutionJobInput {
    readonly jobId: string;
    readonly workerId: string;
    readonly status: Extract<ExecutionJobStatus, "succeeded" | "failed" | "cancelled" | "dead_letter">;
    readonly executionReceiptId?: string;
    readonly lastError?: ExecutionJob["lastError"];
    /** Set when a transient failure should put the job back in `queued`. */
    readonly requeue?: {
        readonly availableAt: string;
        readonly incrementAttempt?: boolean;
    };
}
export interface HeartbeatExecutionJobInput {
    readonly jobId: string;
    readonly workerId: string;
    readonly extendLeaseByMs: number;
    readonly now?: Date;
}
export interface ExecutionJobQueue {
    enqueue(input: EnqueueExecutionJobInput): Promise<void>;
    /**
     * Atomically claim the oldest eligible queued job. Returns `undefined`
     * when the queue is empty for the worker's filter. Also sweeps expired
     * leases back to `queued` as a side effect so a crashed worker's job
     * becomes re-claimable.
     */
    acquire(input: AcquireExecutionJobInput): Promise<ExecutionJob | undefined>;
    /** Extend the current worker's lease during a long-running job. */
    heartbeat(input: HeartbeatExecutionJobInput): Promise<void>;
    /** Idempotent terminal transition. Rejects if the worker is not the owner. */
    complete(input: CompleteExecutionJobInput): Promise<void>;
    /**
     * Mark cancellation requested. The next heartbeat check and the next
     * acquire will see the flag so the worker can stop early.
     */
    requestCancellation(jobId: string, reason: string): Promise<void>;
    /** Read a job's current state. */
    get(jobId: string): Promise<ExecutionJob | undefined>;
    /** Idempotency check: return the existing job for this key, if any. */
    findByIdempotencyKey(key: string): Promise<ExecutionJob | undefined>;
}
