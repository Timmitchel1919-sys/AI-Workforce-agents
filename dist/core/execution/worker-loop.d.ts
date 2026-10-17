/**
 * Worker main loop (R2).
 *
 * One iteration: `acquire` → `dispatch` → `complete` (and release lease).
 * On `undefined` acquire (empty queue) the loop sleeps for `idlePollMs`.
 * Cancellation is cooperative: the loop checks `AbortSignal` between
 * iterations so an orderly shutdown lets an in-flight job finish and
 * commit before exit.
 *
 * The loop is deliberately simple so it runs identically in a Cloud Run
 * container, a local dev process, and an in-process test harness.
 */
import type { ExecutionJob } from "../../contracts/index.js";
import type { ExecutionJobQueue } from "./execution-job-queue.js";
import type { ToolActionDispatcher, ToolActionResult } from "./tool-action-dispatcher.js";
export interface WorkerLoopOptions {
    readonly workerId: string;
    readonly queue: ExecutionJobQueue;
    readonly dispatcher: ToolActionDispatcher;
    /** Lease TTL for each acquired job. Default 60s. */
    readonly leaseTtlMs?: number;
    /** Poll interval when the queue is empty. Default 2s. */
    readonly idlePollMs?: number;
    /** Project filter — allows per-project workers. */
    readonly projectId?: string;
    /** Hook called after each result is committed. */
    readonly onCompleted?: (job: ExecutionJob, result: ToolActionResult) => void;
    /** Injected sleeper for tests. */
    readonly sleep?: (ms: number) => Promise<void>;
}
export declare function runOnce(options: Omit<WorkerLoopOptions, "idlePollMs" | "sleep">): Promise<ExecutionJob | undefined>;
export declare function runWorkerLoop(options: WorkerLoopOptions, shutdown: AbortSignal): Promise<void>;
