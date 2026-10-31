/**
 * Tool-action dispatcher (R2).
 *
 * Routes one `ExecutionJob` to the correct tool-action handler, bounded
 * by a per-run workspace that the dispatcher acquires + releases. Each
 * handler is registered by `toolId` + `action`. Unknown routes fail
 * closed. Returns a structured `ToolActionResult`.
 */
import { ValidationError } from "../../contracts/index.js";
function routeKey(toolId, action) {
    return `${toolId}\u0000${action}`;
}
export class ToolActionDispatcher {
    routes = new Map();
    workspace;
    clock;
    constructor(options) {
        this.workspace = options.workspace;
        this.clock = options.clock ?? Date.now;
    }
    register(route, handler) {
        const key = routeKey(route.toolId, route.action);
        if (this.routes.has(key)) {
            throw new ValidationError(`tool action already registered: ${route.toolId}.${route.action}`);
        }
        this.routes.set(key, handler);
    }
    has(route) {
        return this.routes.has(routeKey(route.toolId, route.action));
    }
    async dispatch(job, signal) {
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
        }
        catch (err) {
            const classified = classifyError(err);
            return {
                status: classified.status,
                durationMs: this.clock() - started,
                error: classified.error,
            };
        }
        finally {
            await lease.release();
        }
    }
}
function classifyError(err) {
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
