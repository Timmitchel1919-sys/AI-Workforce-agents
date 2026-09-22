import { type ToolExecutionLimits, type ToolExecutionRequest, type ToolExecutionRequestDraft, type ToolExecutionResult } from "../../contracts/index.js";
import { ApprovalSystem } from "../approvals/approval-system.js";
import { AuditLog } from "../audit/audit-log.js";
import { PermissionSystem } from "../permissions/permission-system.js";
import { ToolRegistry } from "./tool-registry.js";
export interface ToolExecutionEngineDeps {
    registry: ToolRegistry;
    permissions: PermissionSystem;
    approvals?: ApprovalSystem;
    audit: AuditLog;
    /** Injectable clock (ms). Defaults to `Date.now`. */
    clock?: () => number;
    /** Hard ceilings applied on top of each tool's own limits (a kill-switch). */
    limits?: Partial<ToolExecutionLimits>;
    /** Recorded as the requester on approval records. */
    requestedBy?: string;
}
/**
 * The one secure pipeline every tool call passes through:
 *
 *   validate request → resolve tool → agent / project / environment eligibility
 *   → input-size + call-count limits → PermissionSystem → approval (stop &
 *   resume) → execute (with timeout) → output-size + output-schema → audit →
 *   ToolExecutionResult
 *
 * Deterministic: no randomness, injectable clock, no wall-clock branching on the
 * happy path. An agent gets a `ToolExecutionResult` and never touches a tool
 * handler, the permission system, or a credential directly.
 */
export declare class ToolExecutionEngine {
    private readonly registry;
    private readonly permissions;
    private readonly approvals;
    private readonly audit;
    private readonly clock;
    private readonly ceiling;
    private readonly requestedBy;
    private readonly taskCalls;
    private readonly agentCalls;
    private readonly pending;
    constructor(deps: ToolExecutionEngineDeps);
    /** Build a validated `ToolExecutionRequest` from a draft. */
    createRequest(draft: ToolExecutionRequestDraft): ToolExecutionRequest;
    execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
    /**
     * Re-enter a request that returned `approval_required`, once a human decision
     * exists (or a lapsed expiry when `asOf` is provided).
     */
    resume(requestId: string, options?: {
        asOf?: string;
    }): Promise<ToolExecutionResult>;
    /** Snapshot of the per-task / per-agent call ledger (introspection/tests). */
    callCounts(): {
        task: Record<string, number>;
        agent: Record<string, number>;
    };
    /** Clear ledgers and pending approvals (test isolation). */
    reset(): void;
    private runTool;
    private effectiveLimits;
    private count;
    private bump;
    private emit;
    private err;
    private deny;
    private limitExceeded;
    private finish;
}
