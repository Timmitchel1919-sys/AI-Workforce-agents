/**
 * Pure functions that turn core state into Control-Plane view models. No
 * side effects, no I/O — deterministic given their inputs.
 */
import { type Agent, type AgentOperationalRecord, type AgentOperationalStatus, type AgentView, type Approval, type ApprovalView, type AuditEvent, type AuditEventView, type Task, type TaskView, type Tool, type ToolExecutionStats, type ToolView, type Workflow, type WorkflowControlRecord, type WorkflowView } from "../contracts/index.js";
export declare function deriveAgentStatus(agentId: string, enabled: boolean, agentTasks: readonly Task[]): AgentOperationalStatus;
export declare function deriveAgentView(agent: Agent, allTasks: readonly Task[], opsRecord: AgentOperationalRecord | undefined, audit: readonly AuditEvent[]): AgentView;
export declare function deriveTaskView(task: Task, workflow: Workflow | undefined, approval: Approval | undefined, options?: {
    includeInputShape?: boolean;
}): TaskView;
export declare function deriveWorkflowView(workflow: Workflow, control: WorkflowControlRecord | undefined, approvalsForWorkflow: readonly Approval[]): WorkflowView;
/** Pull `toolId` out of an action like `tool:money-mind.read-status:read`. */
export declare function parseApprovalAction(action: string): {
    toolId?: string;
    kind: string;
};
export declare function deriveApprovalView(approval: Approval): ApprovalView;
export declare function deriveToolStats(toolId: string, audit: readonly AuditEvent[]): ToolExecutionStats;
export declare function deriveToolView(tool: Tool, audit: readonly AuditEvent[]): ToolView;
export declare function deriveAuditEventView(event: AuditEvent): AuditEventView;
/**
 * Centralized page-size bounds for every paginated Control Plane query.
 * Server-side: a request larger than `MAX_PAGE_SIZE` is clamped, so no
 * caller can force an unbounded read.
 */
export declare const DEFAULT_PAGE_SIZE = 25;
export declare const MAX_PAGE_SIZE = 200;
/**
 * Bounded cursor pagination. The cursor is an opaque string encoding the
 * offset into the (already deterministically ordered) result list. A
 * malformed cursor is treated as offset `0` (the first page) — never an
 * error page, never an unbounded read.
 */
export declare function paginate<T>(items: readonly T[], limit: number | undefined, cursor: string | undefined): {
    items: T[];
    total: number;
    nextCursor: string | null;
};
