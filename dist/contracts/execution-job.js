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
export const EXECUTION_JOB_STATUSES = Object.freeze([
    "queued",
    "leased",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "dead_letter",
]);
/**
 * Only transitions that are legal in the execution-job state machine.
 * Rejecting illegal transitions server-side prevents a worker that lost its
 * lease (crash recovery) from pretending its old job is still running.
 */
export const LEGAL_EXECUTION_JOB_TRANSITIONS = Object.freeze({
    queued: Object.freeze(["leased", "cancelled"]),
    // A worker may complete directly from `leased` for short handlers that
    // never report an intermediate `running` state. The intermediate state
    // remains legal (long-running handlers emit it via heartbeat) but is not
    // required.
    leased: Object.freeze([
        "running",
        "queued",
        "cancelled",
        "failed",
        "succeeded",
        "dead_letter",
    ]),
    running: Object.freeze([
        "succeeded",
        "failed",
        "cancelled",
        "queued",
        "dead_letter",
    ]),
    succeeded: Object.freeze([]),
    failed: Object.freeze(["queued", "dead_letter"]),
    cancelled: Object.freeze([]),
    dead_letter: Object.freeze([]),
});
export function canTransitionExecutionJob(from, to) {
    return LEGAL_EXECUTION_JOB_TRANSITIONS[from].includes(to);
}
export function assertExecutionJobTransition(from, to) {
    if (!canTransitionExecutionJob(from, to)) {
        throw new ValidationError(`illegal execution job transition: ${from} → ${to}`);
    }
}
export function validateExecutionJob(job) {
    if (!job.jobId)
        throw new ValidationError("execution job: jobId required");
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
        throw new ValidationError(`execution job: unknown status ${JSON.stringify(job.status)}`);
    }
    if (!Number.isInteger(job.attempt) || job.attempt < 0) {
        throw new ValidationError("execution job: attempt must be a non-negative integer");
    }
    if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1) {
        throw new ValidationError("execution job: maxAttempts must be >= 1");
    }
}
