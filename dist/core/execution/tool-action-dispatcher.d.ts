/**
 * Tool-action dispatcher (R2).
 *
 * Routes one `ExecutionJob` to the correct tool-action handler, bounded
 * by a per-run workspace that the dispatcher acquires + releases. Each
 * handler is registered by `toolId` + `action`. Unknown routes fail
 * closed. Returns a structured `ToolActionResult`.
 */
import { type ExecutionJob } from "../../contracts/index.js";
import type { WorkerWorkspaceManager, WorkspaceAccess } from "./worker-workspace.js";
export type ToolActionStatus = "succeeded" | "failed" | "cancelled" | "timed_out";
export interface ToolActionResult {
    readonly status: ToolActionStatus;
    readonly output?: unknown;
    readonly error?: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
    };
    readonly durationMs: number;
}
export type ToolActionHandler = (args: {
    readonly job: ExecutionJob;
    readonly workspace: WorkspaceAccess;
    readonly signal: AbortSignal;
}) => Promise<unknown>;
interface RouteKey {
    readonly toolId: string;
    readonly action: string;
}
export declare class ToolActionDispatcher {
    private readonly routes;
    private readonly workspace;
    private readonly clock;
    constructor(options: {
        readonly workspace: WorkerWorkspaceManager;
        readonly clock?: () => number;
    });
    register(route: RouteKey, handler: ToolActionHandler): void;
    has(route: RouteKey): boolean;
    dispatch(job: ExecutionJob, signal: AbortSignal): Promise<ToolActionResult>;
}
export {};
