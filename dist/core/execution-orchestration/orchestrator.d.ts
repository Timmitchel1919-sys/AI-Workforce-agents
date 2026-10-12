import { type Agent, type OperatorPrincipal, type Repository } from "../../contracts/index.js";
import { type ExecutionRun, type OrchestrationPolicy, type RunStatus, type RunSummary, type RunView } from "../../contracts/execution-orchestration.js";
import { type PromptRequestView } from "../../contracts/prompt-intelligence.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import { type EventPublisher } from "../events/event-bus.js";
import { AgentRouter } from "./agent-router.js";
import { type CostGate, type ModelRouterPort, type TaskGovernancePort, type TaskRuntimePort, type VerifierPort } from "./ports.js";
import { ResourceLockManager } from "./resource-locks.js";
export interface OrchestratorDeps {
    runs: Repository<ExecutionRun>;
    projects: {
        has(projectId: string): boolean;
    };
    agents: {
        list(): Agent[];
    };
    isAgentEnabled?: (agentId: string) => boolean;
    approvals: Pick<ApprovalSystem, "request" | "get">;
    audit: AuditLog;
    runtime?: TaskRuntimePort;
    verifier?: VerifierPort;
    models?: ModelRouterPort;
    cost?: CostGate;
    /** Layer 7: policy / risk / environment assessment before a task may start. */
    governance?: TaskGovernancePort;
    events?: EventPublisher;
    router?: AgentRouter;
    locks?: ResourceLockManager;
    policy?: Partial<OrchestrationPolicy>;
    clock?: () => string;
    newId?: () => string;
}
export declare class ExecutionOrchestrator {
    private readonly deps;
    private readonly runtime;
    private readonly verifier;
    private readonly router;
    private readonly locks;
    private readonly policy;
    private readonly clock;
    private readonly newId;
    private readonly mutex;
    constructor(deps: OrchestratorDeps);
    private requireOrchestrator;
    private mustSee;
    /** Create a plan (and a run in NOT_STARTED) from a validated Layer 3 request. */
    createRun(principal: OperatorPrincipal, view: PromptRequestView): RunView;
    start(principal: OperatorPrincipal, runId: unknown): RunView;
    pause(principal: OperatorPrincipal, runId: unknown): RunView;
    resume(principal: OperatorPrincipal, runId: unknown): RunView;
    /** Cancel stops all future work; completed work is never pretended undone. */
    cancel(principal: OperatorPrincipal, runId: unknown): Promise<RunView>;
    /** Operator retry of a FAILED or BLOCKED task. SECURITY blocks cannot be retried here. */
    retryTask(principal: OperatorPrincipal, runId: unknown, taskId: unknown): Promise<RunView>;
    /**
     * Advance the run: repeatedly run whatever is ready, up to `maxSteps`
     * rounds, stopping as soon as nothing can progress (blocked, waiting for
     * approval, finished). Safe to call repeatedly; concurrent calls serialize.
     */
    advance(principal: OperatorPrincipal, runId: unknown, maxSteps?: number): Promise<RunView>;
    list(principal: OperatorPrincipal, filter?: {
        projectId?: string;
        limit?: number;
    }): RunSummary[];
    get(principal: OperatorPrincipal, runId: string): Promise<RunView>;
    /** Task counts across the runs the principal may see (for the runtime overview). */
    stats(principal: OperatorPrincipal): {
        queued: number;
        waitingApproval: number;
        failedTasks: number;
        completedToday: number;
    };
    /** Aggregate status derived from the tasks (never stored separately). */
    derive(run: ExecutionRun): RunStatus;
    progress(run: ExecutionRun): {
        total: number;
        completed: number;
        percent: number;
    };
    private view;
    private step;
    /** Route, authorize and gate one task. Returns its context when it may run. */
    private prepare;
    private execute;
    private fail;
    /**
     * LOGICAL gate failure: spawn a correction task for the implementer and
     * re-run every gate that guarded the code that is about to change (a
     * COMPLETED gate is cloned, never reopened — its verification is stale).
     */
    private correct;
    private requestApproval;
    /** The approval state is read from the live ApprovalSystem, never trusted from the run. */
    private syncApprovals;
    private cascadeCancellations;
    /** Routing/budget/runtime blocks are retried each advance; security blocks never are. */
    private reevaluateBlocked;
    private block;
    private move;
    private workload;
    /** Least context: this task's slice + direct upstream summaries. Never secrets. */
    private contextFor;
    private save;
    private emit;
    private publish;
    /** Serialize operations on one run (an in-process mutex). */
    private exclusive;
}
