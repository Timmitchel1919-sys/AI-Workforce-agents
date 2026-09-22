/**
 * Pure HTML rendering for the operations console. No framework, no DOM, no
 * network — each function takes a piece of a `DashboardSnapshot` and returns an
 * HTML string. Deterministic and unit-testable. Every interpolated value is
 * HTML-escaped.
 *
 * `buildDashboardHtml` (build-html.ts) assembles these into one self-contained
 * document. The real data always comes from `WorkforceQueryService`.
 */
import { type AgentView, type ApprovalView, type AuditEventView, type DashboardSnapshot, type ProjectView, type SystemHealth, type TaskView, type ToolView, type WorkforceStatus, type WorkflowView } from "../../contracts/index.js";
export declare const DASHBOARD_VIEWS: readonly ["overview", "agents", "workflows", "tasks", "approvals", "projects", "tools", "audit", "health"];
export type DashboardViewId = (typeof DASHBOARD_VIEWS)[number];
export declare function escapeHtml(value: unknown): string;
export declare function renderOverview(status: WorkforceStatus, recent: readonly AuditEventView[]): string;
export declare function renderAgents(agents: readonly AgentView[]): string;
export declare function renderWorkflows(workflows: readonly WorkflowView[]): string;
export declare function renderTasks(tasks: readonly TaskView[], filter?: {
    status?: string;
    projectId?: string;
}): string;
export declare function renderApprovals(approvals: readonly ApprovalView[]): string;
export declare function renderProjects(projects: readonly ProjectView[]): string;
export declare function renderTools(tools: readonly ToolView[]): string;
export declare function renderAuditRows(events: readonly AuditEventView[]): string;
export declare function renderAudit(page: {
    items: readonly AuditEventView[];
    total: number;
    nextCursor: string | null;
}): string;
export declare function renderHealth(health: SystemHealth): string;
export declare function renderSnapshotBody(snapshot: DashboardSnapshot): string;
