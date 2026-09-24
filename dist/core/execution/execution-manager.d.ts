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
import { type Agent, type ExecutionOperationDefinition, type ExecutionSession, type OperatorPrincipal, type PreflightResult } from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { EnvironmentRegistry } from "../environments/environment-registry.js";
import { type ExecutionPlanningService } from "../planning/execution-planning-service.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import { type ExecutionPolicyRegistry } from "./execution-policy.js";
import { type ExecutionOperationRegistry } from "./execution-operations.js";
import { type CancelOutcome, type ExecutionSessionStore } from "./execution-sessions.js";
import { type SandboxRegistry } from "./sandbox.js";
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
}
export declare class ExecutionManager {
    private readonly options;
    private readonly clock;
    private readonly newId;
    private readonly router;
    private readonly qualification;
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
     * Cancel (operators) or kill (administrators — the emergency switch for ONE
     * session). Idempotent, state-aware and always audited. Agents have no path
     * to this: it is a Control Plane operation authorized by operator role.
     */
    cancel(principal: OperatorPrincipal, sessionId: string, reason: string, kind: "cancel" | "kill"): Promise<{
        outcome: CancelOutcome;
        session: ExecutionSession;
    }>;
    private record;
}
