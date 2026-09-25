/**
 * ExecutionManager — EO-4.1 coordinator of the execution CONTROL BOUNDARY.
 *
 *   authorize → load exact plan revision → stage → operation/tool → input &
 *   workspace paths → agent revalidation → environment revalidation →
 *   policy (deny by default) → approval revalidation → sandbox + limits
 *   → pre-flight result → (optionally) session + scoped capability grants
 *
 * It prepares and governs; it NEVER executes. There is no method that runs a
 * tool, a process or a command, and no path from a request string to an
 * executable. AUTHENTICATED ≠ AUTHORIZED ≠ APPROVED ≠ EXECUTION-CAPABLE: each
 * is its own gate below.
 */
import { type Agent, type Environment, type InvocationResult, type ChangeSet, type RollbackReport, type WorkspaceControl, type ExecutionOperationDefinition, type ExecutionSession, type OperatorPrincipal, type PreflightResult, type ExecutionRecordStore } from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { EnvironmentRegistry } from "../environments/environment-registry.js";
import { type ExecutionPlanningService } from "../planning/execution-planning-service.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import { type ExecutionPolicyRegistry } from "./execution-policy.js";
import { type ExecutionOperationRegistry } from "./execution-operations.js";
import { type CancelOutcome, type ExecutionSessionStore } from "./execution-sessions.js";
import { type SandboxRegistry } from "./sandbox.js";
import { type InMemoryExecutionReceiptStore } from "./execution-receipts.js";
import { type BoundedInvocationDispatcher, type ExecutionToolRegistry } from "./execution-tools.js";
import type { ToolExecutionEngine } from "../tools/tool-execution-engine.js";
import type { EnvironmentAdapterRegistry } from "./environment-adapters.js";
export interface ExecutionManagerOptions {
    planning: Pick<ExecutionPlanningService, "get" | "latest" | "refreshSeries">;
    approvals: Pick<ApprovalSystem, "get">;
    agents: {
        get(id: string): Agent | undefined;
    };
    isAgentEnabled?: (agentId: string) => boolean;
    environments: EnvironmentRegistry;
    tools: Pick<ToolRegistry, "get">;
    projects: {
        has(projectId: string): boolean;
    };
    operations: ExecutionOperationRegistry;
    policies: ExecutionPolicyRegistry;
    sandboxes: SandboxRegistry;
    sessions: ExecutionSessionStore;
    audit: AuditLog;
    clock?: () => string;
    idFactory?: (prefix: string) => string;
    /** Trusted, composition-registered execution tools. */
    executionTools?: ExecutionToolRegistry;
    /** The one bounded tool pipeline every invocation passes through. */
    toolEngine?: ToolExecutionEngine;
    dispatcher?: BoundedInvocationDispatcher;
    receipts?: InMemoryExecutionReceiptStore;
    /** Simultaneous invocations per environment instance. Default 2. */
    maxConcurrentPerEnvironment?: number;
    /** Deployment environment passed to the ToolExecutionEngine. Default local. */
    deploymentEnvironment?: Environment;
    /**
     * EO-4.3 workspace control (ChangeSets, rollback, lease release), provided
     * by the trusted workspace adapter. Reached only through this manager.
     */
    workspaceControl?: WorkspaceControl;
    /**
     * EO-4.8 durable evidence: every receipt is also written (create-only,
     * awaited) to this store, so receipts survive restarts and are visible
     * across Control Plane instances.
     */
    receiptStore?: ExecutionRecordStore;
    /**
     * EO-4.5 environment execution adapters + runners (trusted composition).
     * Operations that declare an `environment` requirement need a ready
     * adapter + runner for the selected instance.
     */
    environmentAdapters?: EnvironmentAdapterRegistry;
}
export declare class ExecutionManager {
    private readonly options;
    private readonly clock;
    private readonly newId;
    private readonly router;
    private readonly qualification;
    /** Running invocations, by session (cancel/kill aborts them). */
    private readonly active;
    /** Idempotency ledger: `${sessionId}\u0000${invocationId}`. */
    private readonly invocations;
    constructor(options: ExecutionManagerOptions);
    /**
     * Evaluate every gate for one plan stage. Returns ELIGIBLE or DENIED with
     * reason codes — never executes. Throws only for authorization (403) and
     * for resources the caller may not see or that do not exist (404, no
     * existence leak).
     */
    preflight(principal: OperatorPrincipal, rawRequest: unknown): Promise<PreflightResult>;
    private authorize;
    private evaluate;
    private resolveOperation;
    private revalidateAgent;
    private revalidateEnvironment;
    private revalidateApprovals;
    /**
     * Create a governed session from a pre-flight. Idempotent per
     * `(operator, idempotencyKey)`: a retry returns the same session; reusing a
     * key for a different request is refused. A DENIED pre-flight produces a
     * terminal `denied` session (evidence) with no grants. Nothing runs.
     */
    createSession(principal: OperatorPrincipal, rawRequest: unknown, idempotencyKey: string): Promise<{
        session: ExecutionSession;
        replayed: boolean;
    }>;
    /** Registered operations (safe metadata). Requires `view`. */
    listOperations(principal: OperatorPrincipal): ExecutionOperationDefinition[];
    /** Session metadata, scoped: invisible and unknown sessions are both 404. */
    getSession(principal: OperatorPrincipal, sessionId: string): Promise<ExecutionSession>;
    listSessions(principal: OperatorPrincipal, projectId: string): Promise<ExecutionSession[]>;
    /**
     * EO-4.8 orphan reconciliation. A session must never stay RUNNING (or
     * CANCELLING) forever because the instance / runner / process that owned
     * its invocation disappeared. When no invocation is live in THIS instance
     * and the open attempt is past its operation timeout (+ grace) — or the
     * whole session budget is exhausted — the session is moved to a terminal
     * state with an explicit reason, through the same compare-and-swap commit
     * (safe across instances). Timestamps only bound liveness here; they
     * never authorize anything.
     */
    private reconcile;
    /**
     * Cancel (operators) or kill (administrators — the emergency switch for ONE
     * session). Idempotent, state-aware and always audited. Agents have no path
     * to this: it is a Control Plane operation authorized by operator role.
     */
    cancel(principal: OperatorPrincipal, sessionId: string, reason: string, kind: "cancel" | "kill"): Promise<{
        outcome: CancelOutcome;
        session: ExecutionSession;
    }>;
    /**
     * Invoke ONE registered operation inside a governed session:
     *
     *   structured request → session state → registered tool + operation →
     *   every pre-flight gate again (plan revision, agent, environment,
     *   approval, policy, input, workspace, sandbox) → capability grants →
     *   environment compatibility → limits + concurrency → ToolExecutionEngine
     *   → sandbox provider (trusted executable, validated argv, no shell)
     *   → output validation + redaction → receipt + audit.
     *
     * Any failed gate is a DENIAL (audited, receipted), never a tool failure.
     * Idempotent per `(session, invocationId)`: a retry replays the result.
     * The normal caller is the orchestrator; it is not exposed over HTTP.
     */
    invoke(principal: OperatorPrincipal, raw: unknown): Promise<InvocationResult>;
    private performInvocation;
    private scopedSession;
    /**
     * End a (persistent) session successfully and release its workspace lease.
     * Idempotent for terminal sessions. Never commits or pushes anything.
     */
    completeSession(principal: OperatorPrincipal, sessionId: string): Promise<ExecutionSession>;
    /** The session ChangeSet (metadata only: paths, hashes, sizes). */
    getChangeSet(principal: OperatorPrincipal, sessionId: string): Promise<ChangeSet | undefined>;
    /**
     * Revert ONLY the mutations this session made (never pre-existing or
     * foreign changes; never a global reset). Operators (`cancel_execution`).
     */
    rollbackWorkspace(principal: OperatorPrincipal, sessionId: string): Promise<RollbackReport>;
    /** In-memory index + durable, create-only evidence (EO-4.8). */
    private persistReceipt;
    private releaseWorkspace;
    /** A denied invocation: audited + receipted; the session is untouched. */
    private denied;
    private record;
}
