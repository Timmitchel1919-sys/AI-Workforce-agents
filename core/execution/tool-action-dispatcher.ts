/**
 * Tool-action dispatcher (R2).
 *
 * Routes one `ExecutionJob` to the correct tool-action handler, bounded
 * by a per-run workspace that the dispatcher acquires + releases. Each
 * handler is registered by `toolId` + `action`. Unknown routes fail
 * closed. Returns a structured `ToolActionResult`.
 */
import {
  ValidationError,
  type ExecutionJob,
} from "../../contracts/index.js";
import type {
  WorkerWorkspaceManager,
  WorkspaceAccess,
} from "./worker-workspace.js";

export type ToolActionStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

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

function routeKey(toolId: string, action: string): string {
  return `${toolId}\u0000${action}`;
}

export class ToolActionDispatcher {
  private readonly routes = new Map<string, ToolActionHandler>();
  private readonly workspace: WorkerWorkspaceManager;
  private readonly clock: () => number;

  constructor(options: {
    readonly workspace: WorkerWorkspaceManager;
    readonly clock?: () => number;
  }) {
    this.workspace = options.workspace;
    this.clock = options.clock ?? Date.now;
  }

  register(route: RouteKey, handler: ToolActionHandler): void {
    const key = routeKey(route.toolId, route.action);
    if (this.routes.has(key)) {
      throw new ValidationError(
        `tool action already registered: ${route.toolId}.${route.action}`,
      );
    }
    this.routes.set(key, handler);
  }

  has(route: RouteKey): boolean {
    return this.routes.has(routeKey(route.toolId, route.action));
  }

  async dispatch(
    job: ExecutionJob,
    signal: AbortSignal,
  ): Promise<ToolActionResult> {
    const key = routeKey(job.tool.toolId, job.tool.action);
    const handler = this.routes.get(key);
    const started = this.clock();
    if (!handler) {
      return {
        status: "failed",
        durationMs: this.clock() - started,
        error: {
          code: "unknown_tool_action",
          message: `no handler registered for ${job.tool.toolId}.${job.tool.action}`,
          retryable: false,
        },
      };
    }
    const workspaceId = `${job.projectId}-${job.jobId}`;
    const lease = await this.workspace.acquire({
      workspaceId,
      projectId: job.projectId,
    });
    try {
      if (signal.aborted) {
        return {
          status: "cancelled",
          durationMs: this.clock() - started,
          error: {
            code: "cancelled",
            message: "cancellation requested before dispatch",
            retryable: false,
          },
        };
      }
      const output = await handler({
        job,
        workspace: lease,
        signal,
      });
      return {
        status: "succeeded",
        output,
        durationMs: this.clock() - started,
      };
    } catch (err) {
      const classified = classifyError(err);
      return {
        status: classified.status,
        durationMs: this.clock() - started,
        error: classified.error,
      };
    } finally {
      await lease.release();
    }
  }
}

function classifyError(err: unknown): {
  status: ToolActionStatus;
  error: NonNullable<ToolActionResult["error"]>;
} {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "Error";
  if (name === "AbortError") {
    return {
      status: "cancelled",
      error: { code: "cancelled", message, retryable: false },
    };
  }
  if (/timeout|timed out/i.test(message)) {
    return {
      status: "timed_out",
      error: { code: "timeout", message, retryable: true },
    };
  }
  if (name === "ValidationError") {
    return {
      status: "failed",
      error: { code: "validation_error", message, retryable: false },
    };
  }
  return {
    status: "failed",
    error: { code: "internal_error", message, retryable: true },
  };
}
