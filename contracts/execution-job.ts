/**
 * Durable execution-job contract (R2).
 *
 * An `ExecutionJob` is one unit of work the Control Plane enqueues and a
 * worker (Cloud Run service, or in-process worker in test) claims, executes
 * and completes. Job state is durable (Firestore); the worker is stateless
 * between jobs except for a temporary workspace scratch.
 *
 * Design rules:
 *   - Never persist plaintext secrets or raw credentials here. Agents must
 *     use secret references resolved by the trusted broker at execution time.
 *   - `input` is the tool action payload; the shape is governed by each tool's
 *     own input validator.
 *   - `idempotencyKey` is required so a replay never produces a duplicate
 *     side effect.
 */
import { ValidationError } from "./index.js";

export type ExecutionJobStatus =
  | "queued"
  | "leased"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "dead_letter";

export const EXECUTION_JOB_STATUSES: readonly ExecutionJobStatus[] =
  Object.freeze([
    "queued",
    "leased",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "dead_letter",
  ]);

/**
 * The tool action the worker will carry out. Carries the normalized input
 * for the governed tool handler — no shell strings, no raw host paths.
 */
export interface ExecutionJobToolAction {
  readonly toolId: string;
  readonly action: string;
  readonly input: unknown;
  readonly requiredCapability: string;
}

/** Durable job metadata. See `ExecutionJob` for the full contract. */
export interface ExecutionJobLease {
  readonly leaseId: string;
  readonly workerId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly heartbeatAt: string;
}

export interface ExecutionJob {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly assignmentId?: string;
  readonly executionId: string;
  readonly tool: ExecutionJobToolAction;
  readonly status: ExecutionJobStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly availableAt: string;
  readonly updatedAt: string;
  readonly lease?: ExecutionJobLease;
  readonly cancellationRequested?: boolean;
  readonly cancellationReason?: string;
  readonly lastError?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly recordedAt: string;
  };
  readonly executionReceiptId?: string;
  readonly completedAt?: string;
}

/**
 * Only transitions that are legal in the execution-job state machine.
 * Rejecting illegal transitions server-side prevents a worker that lost its
 * lease (crash recovery) from pretending its old job is still running.
 */
export const LEGAL_EXECUTION_JOB_TRANSITIONS: Readonly<
  Record<ExecutionJobStatus, readonly ExecutionJobStatus[]>
> = Object.freeze({
  queued: Object.freeze<ExecutionJobStatus[]>(["leased", "cancelled"]),
  // A worker may complete directly from `leased` for short handlers that
  // never report an intermediate `running` state. The intermediate state
  // remains legal (long-running handlers emit it via heartbeat) but is not
  // required.
  leased: Object.freeze<ExecutionJobStatus[]>([
    "running",
    "queued",
    "cancelled",
    "failed",
    "succeeded",
    "dead_letter",
  ]),
  running: Object.freeze<ExecutionJobStatus[]>([
    "succeeded",
    "failed",
    "cancelled",
    "queued",
    "dead_letter",
  ]),
  succeeded: Object.freeze<ExecutionJobStatus[]>([]),
  failed: Object.freeze<ExecutionJobStatus[]>(["queued", "dead_letter"]),
  cancelled: Object.freeze<ExecutionJobStatus[]>([]),
  dead_letter: Object.freeze<ExecutionJobStatus[]>([]),
});

export function canTransitionExecutionJob(
  from: ExecutionJobStatus,
  to: ExecutionJobStatus,
): boolean {
  return LEGAL_EXECUTION_JOB_TRANSITIONS[from].includes(to);
}

export function assertExecutionJobTransition(
  from: ExecutionJobStatus,
  to: ExecutionJobStatus,
): void {
  if (!canTransitionExecutionJob(from, to)) {
    throw new ValidationError(
      `illegal execution job transition: ${from} → ${to}`,
    );
  }
}

export function validateExecutionJob(job: ExecutionJob): void {
  if (!job.jobId) throw new ValidationError("execution job: jobId required");
  if (!job.idempotencyKey) {
    throw new ValidationError("execution job: idempotencyKey required");
  }
  if (!job.projectId) {
    throw new ValidationError("execution job: projectId required");
  }
  if (!job.tool || !job.tool.toolId || !job.tool.action) {
    throw new ValidationError("execution job: tool action required");
  }
  if (!EXECUTION_JOB_STATUSES.includes(job.status)) {
    throw new ValidationError(
      `execution job: unknown status ${JSON.stringify(job.status)}`,
    );
  }
  if (!Number.isInteger(job.attempt) || job.attempt < 0) {
    throw new ValidationError(
      "execution job: attempt must be a non-negative integer",
    );
  }
  if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1) {
    throw new ValidationError("execution job: maxAttempts must be >= 1");
  }
}
