/* ------------------------------------------------------------------ */
/* Execution session state machine                                    */
/* ------------------------------------------------------------------ */
export const RUNTIME_STATES = [
    "CREATED",
    "INITIALIZING",
    "READY",
    "RUNNING",
    "PAUSED",
    "WAITING_APPROVAL",
    "REVIEWING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
];
/** There is deliberately no edge from any state to a deployment state. */
export const RUNTIME_TRANSITIONS = Object.freeze({
    CREATED: ["INITIALIZING", "CANCELLED", "FAILED"],
    INITIALIZING: ["READY", "FAILED", "CANCELLED"],
    READY: ["RUNNING", "CANCELLED", "FAILED"],
    RUNNING: [
        "PAUSED",
        "WAITING_APPROVAL",
        "REVIEWING",
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
    ],
    PAUSED: ["RUNNING", "CANCELLED", "FAILED"],
    WAITING_APPROVAL: ["RUNNING", "CANCELLED", "FAILED"],
    REVIEWING: ["SUCCEEDED", "FAILED", "RUNNING", "CANCELLED"],
    SUCCEEDED: [],
    FAILED: [],
    CANCELLED: [],
    TIMED_OUT: [],
});
export function canTransitionRuntime(from, to) {
    return RUNTIME_TRANSITIONS[from].includes(to);
}
export const TERMINAL_RUNTIME_STATES = [
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
];
/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */
export const RUNTIME_ERROR_KINDS = [
    "ENVIRONMENT_ERROR",
    "COMMAND_ERROR",
    "CODE_ERROR",
    "TEST_FAILURE",
    "BUILD_FAILURE",
    "NETWORK_ERROR",
    "AUTHORIZATION_ERROR",
    "SECURITY_ERROR",
    "TIMEOUT",
    "AGENT_ERROR",
    "MODEL_ERROR",
    "TOOL_ERROR",
];
/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */
export const RUNTIME_WORKSPACE_OPERATIONS = [
    "read",
    "list",
    "create",
    "update",
    "rename",
    "move",
    "delete",
    "run_script",
    "git_read",
    "git_write",
];
/** The environment a workspace lives in. Only `local` is implemented now. */
export const RUNTIME_WORKSPACE_ENVIRONMENTS = [
    "local",
    "docker",
    "cloud_runner",
    "wsl",
];
/* ------------------------------------------------------------------ */
/* Commands                                                           */
/* ------------------------------------------------------------------ */
export const COMMAND_CLASSES = ["SAFE", "REVIEW_REQUIRED", "BLOCKED"];
/* ------------------------------------------------------------------ */
/* Validation pipeline                                                */
/* ------------------------------------------------------------------ */
export const VALIDATION_STAGES = [
    "typecheck",
    "lint",
    "test",
    "build",
];
/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */
export const RUNTIME_EVENT_TYPES = [
    "execution.created",
    "execution.started",
    "execution.state",
    "execution.command.started",
    "execution.command.output",
    "execution.command.completed",
    "execution.file.changed",
    "execution.test.started",
    "execution.test.completed",
    "execution.build.started",
    "execution.build.completed",
    "execution.scope.flagged",
    "execution.agent.step",
    "execution.approval.requested",
    "execution.failed",
    "execution.cancelled",
    "execution.completed",
];
export const RUNTIME_COMMANDS = [
    "runtime_cancel_session",
    "runtime_pause_session",
    "runtime_resume_session",
];
/** Bounds on everything the runtime keeps or returns. */
export const RUNTIME_LIMITS = Object.freeze({
    maxOutputBytes: 64 * 1024,
    maxReadBytes: 256 * 1024,
    maxDiffBytes: 32 * 1024,
    maxEvents: 300,
    maxCommands: 40,
    maxChanges: 200,
    maxTools: 200,
    maxFileOps: 500,
    maxConcurrentSessions: 3,
    defaultTimeoutMs: 120_000,
    staleHeartbeatMs: 5 * 60_000,
});
