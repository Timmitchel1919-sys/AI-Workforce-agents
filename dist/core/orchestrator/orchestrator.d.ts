import { type Agent, type AgentExecutor, type Approval, type ApprovalPolicy, type Environment, type Handoff, type HandoffDraft, type Task, type TaskDraft } from "../../contracts/index.js";
import { ApprovalSystem } from "../approvals/approval-system.js";
import { AuditLog } from "../audit/audit-log.js";
import { HandoffSystem } from "../handoffs/handoff-system.js";
import { PermissionSystem } from "../permissions/permission-system.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { TaskSystem } from "../tasks/task-system.js";
export type AgentSelector = (candidates: readonly Agent[], task: Task) => Agent;
/** Deterministic default selection: lowest agent id among the candidates. */
export declare const selectFirstById: AgentSelector;
/** Default approval policy: nothing needs approval. */
export declare const approveNothing: ApprovalPolicy;
/**
 * Optional operational gate: an agent an operator has disabled (via the
 * Control Plane) cannot receive new tasks. Defaults to "everyone enabled".
 */
export interface AgentGate {
    isEnabled(agentId: string): boolean;
}
export interface OrchestratorOptions {
    selectAgent?: AgentSelector;
    approvalPolicy?: ApprovalPolicy;
    permissions?: PermissionSystem;
    environment?: Environment;
    agentGate?: AgentGate;
}
export type ResumeOutcome = "approved" | "rejected" | "expired";
/**
 * Minimal deterministic orchestrator.
 *
 * `submit` validates and queues a task, selects an eligible agent, enforces
 * permissions at the dispatch boundary, gates on human approval when the
 * approval policy requires it, and otherwise dispatches execution — recording
 * an audit event at every step. `resume` re-enters a task that was parked in
 * `awaiting_approval` once a human decision exists. No autonomous planning.
 */
export declare class Orchestrator {
    private readonly registry;
    private readonly tasks;
    private readonly handoffs;
    private readonly audit;
    private readonly executor;
    private readonly approvals;
    private readonly selectAgent;
    private readonly approvalPolicy;
    private readonly permissions;
    private readonly environment;
    private readonly agentGate;
    constructor(registry: AgentRegistry, tasks: TaskSystem, handoffs: HandoffSystem, audit: AuditLog, executor: AgentExecutor, approvals?: ApprovalSystem, options?: OrchestratorOptions);
    submit(draft: TaskDraft): Promise<Task>;
    /**
     * Record a human decision on the approval blocking a task. This is NOT
     * auto-approval — the caller supplies the decision.
     */
    recordApprovalDecision(approvalId: string, decision: "approved" | "rejected", decidedBy: string, metadata?: Record<string, unknown>): Approval;
    /**
     * Re-enter a task parked in `awaiting_approval`. Requires an existing human
     * decision (or a lapsed expiry when `asOf` is provided).
     */
    resume(taskId: string, options?: {
        asOf?: string;
    }): Promise<Task>;
    /** Validate and accept a handoff between two registered agents on a task. */
    requestHandoff(draft: HandoffDraft): Handoff;
    private dispatch;
    /**
     * Assert every declared required permission for the task at the dispatch
     * boundary. Returns a `PermissionDeniedError` on the first denial, or
     * `undefined` if all checks pass. Each check is audited.
     */
    private enforcePermissions;
    private makeGuard;
    private toPermissionRequest;
    private failTask;
}
