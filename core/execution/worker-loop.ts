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
import type {
  ExecutionJob,
  ExecutionJobStatus,
} from "../../contracts/index.js";
import type { ExecutionJobQueue } from "./execution-job-queue.js";
import type {
  ToolActionDispatcher,
  ToolActionResult,
} from "./tool-action-dispatcher.js";

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

export async function runOnce(
  options: Omit<WorkerLoopOptions, "idlePollMs" | "sleep">,
): Promise<ExecutionJob | undefined> {
  const leaseTtlMs = options.leaseTtlMs ?? 60_000;
  const job = await options.queue.acquire({
    workerId: options.workerId,
    leaseTtlMs,
    projectId: options.projectId,
  });
  if (!job) return undefined;
  const controller = new AbortController();
  const result = await options.dispatcher.dispatch(job, controller.signal);
  const terminal = mapResultStatus(result.status);
  await options.queue.complete({
    jobId: job.jobId,
    workerId: options.workerId,
    status: terminal,
    lastError: result.error
      ? {
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable,
          recordedAt: new Date().toISOString(),
        }
      : undefined,
  });
  options.onCompleted?.(job, result);
  return job;
}

export async function runWorkerLoop(
  options: WorkerLoopOptions,
  shutdown: AbortSignal,
): Promise<void> {
  const idle = options.idlePollMs ?? 2_000;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  while (!shutdown.aborted) {
    const job = await runOnce(options);
    if (!job) {
      await sleep(idle);
    }
  }
}

function mapResultStatus(
  status: ToolActionResult["status"],
): Extract<
  ExecutionJobStatus,
  "succeeded" | "failed" | "cancelled" | "dead_letter"
> {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "timed_out":
    case "failed":
    default:
      return "failed";
  }
}
