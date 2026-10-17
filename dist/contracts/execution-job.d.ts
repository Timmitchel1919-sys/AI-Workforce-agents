export type ExecutionJobStatus = "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled" | "dead_letter";
export declare const EXECUTION_JOB_STATUSES: readonly ExecutionJobStatus[];
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
export declare const LEGAL_EXECUTION_JOB_TRANSITIONS: Readonly<Record<ExecutionJobStatus, readonly ExecutionJobStatus[]>>;
export declare function canTransitionExecutionJob(from: ExecutionJobStatus, to: ExecutionJobStatus): boolean;
export declare function assertExecutionJobTransition(from: ExecutionJobStatus, to: ExecutionJobStatus): void;
export declare function validateExecutionJob(job: ExecutionJob): void;
