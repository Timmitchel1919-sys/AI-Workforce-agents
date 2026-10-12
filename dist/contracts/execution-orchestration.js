/* ------------------------------------------------------------------ */
/* Task model                                                         */
/* ------------------------------------------------------------------ */
export const ORCH_TASK_TYPES = [
    "RESEARCH",
    "ANALYSIS",
    "DESIGN",
    "DEVELOPMENT",
    "REVIEW",
    "TEST",
    "SECURITY",
    "DOCUMENTATION",
    "INTEGRATION",
    "DEPLOYMENT",
    "MAINTENANCE",
];
export const ORCH_TASK_STATUSES = [
    "PENDING",
    "READY",
    "QUEUED",
    "RUNNING",
    "BLOCKED",
    "WAITING_APPROVAL",
    "REVIEW",
    "FAILED",
    "RETRYING",
    "COMPLETED",
    "CANCELLED",
];
/**
 * The only legal task transitions. `COMPLETED` and `CANCELLED` are terminal;
 * `FAILED` is terminal until an explicit operator retry (FAILED → RETRYING).
 */
export const ORCH_TASK_TRANSITIONS = Object.freeze({
    PENDING: ["READY", "BLOCKED", "WAITING_APPROVAL", "CANCELLED"],
    READY: [
        "QUEUED",
        "RUNNING",
        "BLOCKED",
        "WAITING_APPROVAL",
        "CANCELLED",
        "PENDING",
    ],
    QUEUED: ["RUNNING", "READY", "BLOCKED", "WAITING_APPROVAL", "CANCELLED"],
    RUNNING: ["REVIEW", "FAILED", "RETRYING", "BLOCKED", "CANCELLED"],
    BLOCKED: ["READY", "PENDING", "FAILED", "CANCELLED"],
    WAITING_APPROVAL: [
        "PENDING",
        "READY",
        "QUEUED",
        "RUNNING",
        "CANCELLED",
        "BLOCKED",
    ],
    REVIEW: ["COMPLETED", "FAILED", "RETRYING", "BLOCKED", "CANCELLED"],
    FAILED: ["RETRYING", "CANCELLED"],
    RETRYING: ["READY", "PENDING", "FAILED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
});
export function canTransitionOrchTask(from, to) {
    return ORCH_TASK_TRANSITIONS[from].includes(to);
}
export const TERMINAL_TASK_STATUSES = [
    "COMPLETED",
    "CANCELLED",
];
export const ORCH_PRIORITIES = ["low", "normal", "high", "critical"];
export const FAILURE_CLASSES = [
    "TRANSIENT",
    "LOGICAL",
    "SECURITY",
    "APPROVAL",
];
export const RECOVERY_ACTIONS = [
    "RETRY",
    "CORRECT",
    "REASSIGN",
    "WAIT",
    "BLOCK",
    "ESCALATE",
];
/* ------------------------------------------------------------------ */
/* Run (workflow) model                                               */
/* ------------------------------------------------------------------ */
export const RUN_STATUSES = [
    "NOT_STARTED",
    "PLANNING",
    "EXECUTING",
    "BLOCKED",
    "WAITING_APPROVAL",
    "REVIEW",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
];
export const DEFAULT_ORCHESTRATION_POLICY = Object.freeze({
    maxRetries: 2,
    maxCorrections: 2,
    maxParallel: 3,
    lockTtlMs: 10 * 60_000,
    retryBackoffMs: 5_000,
});
export const ORCHESTRATION_COMMANDS = [
    "orchestration_create",
    "orchestration_start",
    "orchestration_advance",
    "orchestration_pause",
    "orchestration_resume",
    "orchestration_cancel",
    "orchestration_retry_task",
];
