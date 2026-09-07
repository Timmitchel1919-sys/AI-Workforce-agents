import {
  type Tool,
  type ToolExecutionContext,
  type ToolExecutionError,
  type ToolExecutionLimits,
  type ToolExecutionPhase,
  type ToolExecutionRequest,
  type ToolExecutionRequestDraft,
  type ToolExecutionResult,
  type ToolExecutionStatus,
  type ToolFailureReason,
  NotFoundError,
  ValidationError,
  toolPermissionRequest,
  validateToolExecutionRequest,
} from "../../contracts/index.js";
import { ApprovalSystem } from "../approvals/approval-system.js";
import { AuditLog } from "../audit/audit-log.js";
import { PermissionSystem } from "../permissions/permission-system.js";
import { createId, now } from "../shared.js";
import { ToolRegistry } from "./tool-registry.js";
import {
  agentAllowed,
  environmentAllowed,
  projectAllowed,
  toolApprovalRequired,
} from "./tool-policy.js";

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

interface PendingApproval {
  request: ToolExecutionRequest;
  approvalId: string;
}

class ToolTimeoutSignal extends Error {}

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
export class ToolExecutionEngine {
  private readonly registry: ToolRegistry;
  private readonly permissions: PermissionSystem;
  private readonly approvals: ApprovalSystem;
  private readonly audit: AuditLog;
  private readonly clock: () => number;
  private readonly ceiling: Partial<ToolExecutionLimits>;
  private readonly requestedBy: string;

  private readonly taskCalls = new Map<string, number>();
  private readonly agentCalls = new Map<string, number>();
  private readonly pending = new Map<string, PendingApproval>();

  constructor(deps: ToolExecutionEngineDeps) {
    this.registry = deps.registry;
    this.permissions = deps.permissions;
    this.approvals = deps.approvals ?? new ApprovalSystem();
    this.audit = deps.audit;
    this.clock = deps.clock ?? Date.now;
    this.ceiling = deps.limits ?? {};
    this.requestedBy = deps.requestedBy ?? "tool-execution-engine";
  }

  /** Build a validated `ToolExecutionRequest` from a draft. */
  createRequest(draft: ToolExecutionRequestDraft): ToolExecutionRequest {
    const fallbackAction =
      this.registry.get(draft.toolId)?.requiredPermission.action ?? "execute";
    return {
      requestId: createId("toolreq"),
      taskId: draft.taskId,
      agentId: draft.agentId,
      projectId: draft.projectId,
      toolId: draft.toolId,
      action: draft.action ?? fallbackAction,
      input: draft.input ?? null,
      environment: draft.environment ?? "local",
      requestedAt: now(),
      metadata: { ...(draft.metadata ?? {}) },
    };
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const started = this.clock();
    this.emit(request, "requested", {
      toolId: request.toolId,
      action: request.action,
      environment: request.environment,
    });

    try {
      validateToolExecutionRequest(request);
    } catch (error) {
      return this.finish(
        request,
        started,
        "failure",
        this.err("invalid_request", message(error)),
      );
    }
    this.emit(request, "validated", {});

    const tool = this.registry.get(request.toolId);
    if (!tool) {
      return this.finish(
        request,
        started,
        "failure",
        this.err("unknown_tool", `no tool registered as "${request.toolId}"`),
      );
    }
    this.emit(request, "resolved", { version: tool.version });

    if (!agentAllowed(tool, request.agentId)) {
      return this.deny(
        request,
        started,
        "agent_not_allowed",
        `agent "${request.agentId}" may not use tool "${tool.id}"`,
      );
    }
    if (!projectAllowed(tool, request.projectId)) {
      return this.deny(
        request,
        started,
        "project_not_allowed",
        `project "${request.projectId}" may not use tool "${tool.id}"`,
      );
    }
    if (!environmentAllowed(tool, request.environment)) {
      return this.deny(
        request,
        started,
        "environment_not_allowed",
        `tool "${tool.id}" is not allowed in environment "${request.environment}"`,
      );
    }

    const limits = this.effectiveLimits(tool);

    const inputBytes = byteLength(request.input);
    if (inputBytes > limits.maxInputBytes) {
      return this.limitExceeded(request, started, "input_too_large", {
        inputBytes,
        max: limits.maxInputBytes,
      });
    }

    if (
      this.count(this.taskCalls, taskKey(request)) >= limits.maxCallsPerTask
    ) {
      return this.limitExceeded(request, started, "call_limit_exceeded", {
        scope: "task",
        max: limits.maxCallsPerTask,
      });
    }
    if (
      this.count(this.agentCalls, agentKey(request)) >= limits.maxCallsPerAgent
    ) {
      return this.limitExceeded(request, started, "call_limit_exceeded", {
        scope: "agent",
        max: limits.maxCallsPerAgent,
      });
    }

    const decision = this.permissions.evaluate(toolPermissionRequest(request));
    this.audit.record("permission_decision", {
      taskId: request.taskId,
      agentId: request.agentId,
      projectId: request.projectId,
      data: {
        toolId: tool.id,
        action: request.action,
        environment: request.environment,
        allowed: decision.allowed,
        reason: decision.reason,
        via: "tool-execution-engine",
      },
    });
    if (!decision.allowed) {
      return this.deny(request, started, "permission_denied", decision.reason);
    }
    this.emit(request, "authorized", { reason: decision.reason });

    const approval = toolApprovalRequired(tool, request);
    if (approval.required) {
      const record = this.approvals.request({
        action: `tool:${tool.id}:${request.action}`,
        requestedBy: `${this.requestedBy}:${request.agentId}`,
        reason: approval.reason,
        metadata: {
          taskId: request.taskId,
          requestId: request.requestId,
          toolId: tool.id,
        },
      });
      this.audit.record("approval_requested", {
        taskId: request.taskId,
        agentId: request.agentId,
        projectId: request.projectId,
        data: {
          approvalId: record.id,
          toolId: tool.id,
          action: request.action,
          reason: approval.reason,
        },
      });
      this.emit(request, "approval_required", { approvalId: record.id });
      this.pending.set(request.requestId, {
        request,
        approvalId: record.id,
      });
      return {
        requestId: request.requestId,
        toolId: tool.id,
        taskId: request.taskId,
        status: "approval_required",
        approvalId: record.id,
        durationMs: this.clock() - started,
        timestamp: now(),
        metadata: { reason: approval.reason },
      };
    }

    return this.runTool(request, tool, started);
  }

  /**
   * Re-enter a request that returned `approval_required`, once a human decision
   * exists (or a lapsed expiry when `asOf` is provided).
   */
  async resume(
    requestId: string,
    options: { asOf?: string } = {},
  ): Promise<ToolExecutionResult> {
    const held = this.pending.get(requestId);
    if (!held) {
      throw new NotFoundError(
        `no tool request awaiting approval: ${requestId}`,
      );
    }
    if (options.asOf) this.approvals.expireStale(options.asOf);

    const approval = this.approvals.require(held.approvalId);
    if (approval.status === "requested") {
      throw new ValidationError(
        `approval ${approval.id} for request ${requestId} is still pending`,
      );
    }

    const started = this.clock();
    this.pending.delete(requestId);
    this.audit.record("approval_decided", {
      taskId: held.request.taskId,
      agentId: held.request.agentId,
      projectId: held.request.projectId,
      data: {
        approvalId: approval.id,
        decision: approval.status,
        toolId: held.request.toolId,
      },
    });

    if (approval.status === "rejected") {
      this.emit(held.request, "denied", {
        approvalId: approval.id,
        reason: "approval_rejected",
      });
      return this.finish(
        held.request,
        started,
        "denied",
        this.err("approval_rejected", "the approval was rejected", {
          approvalId: approval.id,
        }),
      );
    }
    if (approval.status === "expired") {
      this.emit(held.request, "denied", {
        approvalId: approval.id,
        reason: "approval_expired",
      });
      return this.finish(
        held.request,
        started,
        "denied",
        this.err("approval_expired", "the approval expired", {
          approvalId: approval.id,
        }),
      );
    }

    // approved — re-authorize (grants may have changed) then execute
    const tool = this.registry.require(held.request.toolId);
    const decision = this.permissions.evaluate(
      toolPermissionRequest(held.request),
    );
    if (!decision.allowed) {
      return this.deny(
        held.request,
        started,
        "permission_denied",
        decision.reason,
      );
    }
    this.emit(held.request, "approved", { approvalId: approval.id });
    return this.runTool(held.request, tool, started);
  }

  /** Snapshot of the per-task / per-agent call ledger (introspection/tests). */
  callCounts(): {
    task: Record<string, number>;
    agent: Record<string, number>;
  } {
    return {
      task: Object.fromEntries(this.taskCalls),
      agent: Object.fromEntries(this.agentCalls),
    };
  }

  /** Clear ledgers and pending approvals (test isolation). */
  reset(): void {
    this.taskCalls.clear();
    this.agentCalls.clear();
    this.pending.clear();
  }

  /* -------------------------------------------------------------- */
  /* internals                                                      */
  /* -------------------------------------------------------------- */

  private async runTool(
    request: ToolExecutionRequest,
    tool: Tool,
    started: number,
  ): Promise<ToolExecutionResult> {
    const limits = this.effectiveLimits(tool);
    const timeoutMs = Math.min(tool.timeoutMs, limits.maxDurationMs);

    this.bump(this.taskCalls, taskKey(request));
    this.bump(this.agentCalls, agentKey(request));

    if (tool.inputSchema) {
      try {
        tool.inputSchema(request.input);
      } catch (error) {
        this.emit(request, "failed", { reason: "malformed_result" });
        return this.finish(
          request,
          started,
          "failure",
          this.err(
            "malformed_result",
            `input schema rejected the request: ${message(error)}`,
          ),
        );
      }
    }

    this.emit(request, "executing", { timeoutMs });
    const context: ToolExecutionContext = {
      requestId: request.requestId,
      taskId: request.taskId,
      agentId: request.agentId,
      projectId: request.projectId,
      environment: request.environment,
      deadlineMs: this.clock() + timeoutMs,
    };

    const callStart = this.clock();
    let output: unknown;
    try {
      output = await withTimeout(
        () => tool.execute(request.input, context),
        timeoutMs,
      );
    } catch (error) {
      if (error instanceof ToolTimeoutSignal) {
        this.emit(request, "timeout", { timeoutMs });
        return this.finish(
          request,
          started,
          "timeout",
          this.err("timeout", `tool timed out after ${timeoutMs}ms`, {
            timeoutMs,
          }),
        );
      }
      this.emit(request, "failed", { error: message(error) });
      return this.finish(
        request,
        started,
        "failure",
        this.err("tool_error", message(error)),
      );
    }

    const elapsed = this.clock() - callStart;
    if (elapsed > timeoutMs) {
      this.emit(request, "timeout", { timeoutMs, elapsed });
      return this.finish(
        request,
        started,
        "timeout",
        this.err(
          "timeout",
          `tool exceeded ${timeoutMs}ms (took ${elapsed}ms)`,
          { timeoutMs, elapsed },
        ),
      );
    }

    const outputBytes = byteLength(output);
    if (outputBytes > limits.maxOutputBytes) {
      this.emit(request, "failed", {
        reason: "output_too_large",
        outputBytes,
      });
      return this.finish(
        request,
        started,
        "failure",
        this.err(
          "output_too_large",
          `output ${outputBytes} bytes exceeds ${limits.maxOutputBytes}`,
          { outputBytes, max: limits.maxOutputBytes },
        ),
      );
    }

    if (tool.outputSchema) {
      try {
        tool.outputSchema(output);
      } catch (error) {
        this.emit(request, "failed", { reason: "malformed_result" });
        return this.finish(
          request,
          started,
          "failure",
          this.err(
            "malformed_result",
            `output schema rejected the result: ${message(error)}`,
          ),
        );
      }
    }

    this.emit(request, "completed", {
      durationMs: elapsed,
      outputBytes,
    });
    return {
      requestId: request.requestId,
      toolId: tool.id,
      taskId: request.taskId,
      status: "success",
      output,
      durationMs: this.clock() - started,
      timestamp: now(),
      metadata: { toolVersion: tool.version, callDurationMs: elapsed },
    };
  }

  private effectiveLimits(tool: Tool): ToolExecutionLimits {
    const t = tool.limits;
    const c = this.ceiling;
    return {
      maxCallsPerTask: Math.min(
        t.maxCallsPerTask,
        c.maxCallsPerTask ?? t.maxCallsPerTask,
      ),
      maxCallsPerAgent: Math.min(
        t.maxCallsPerAgent,
        c.maxCallsPerAgent ?? t.maxCallsPerAgent,
      ),
      maxDurationMs: Math.min(
        t.maxDurationMs,
        c.maxDurationMs ?? t.maxDurationMs,
      ),
      maxInputBytes: Math.min(
        t.maxInputBytes,
        c.maxInputBytes ?? t.maxInputBytes,
      ),
      maxOutputBytes: Math.min(
        t.maxOutputBytes,
        c.maxOutputBytes ?? t.maxOutputBytes,
      ),
    };
  }

  private count(map: Map<string, number>, key: string): number {
    return map.get(key) ?? 0;
  }

  private bump(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  private emit(
    request: ToolExecutionRequest,
    phase: ToolExecutionPhase,
    data: Record<string, unknown>,
  ): void {
    this.audit.record("tool_execution", {
      taskId: request.taskId,
      agentId: request.agentId,
      projectId: request.projectId,
      data: {
        phase,
        requestId: request.requestId,
        toolId: request.toolId,
        ...data,
      },
    });
  }

  private err(
    reason: ToolFailureReason,
    message: string,
    details: Record<string, unknown> = {},
  ): ToolExecutionError {
    return { reason, message, details };
  }

  private deny(
    request: ToolExecutionRequest,
    started: number,
    reason: ToolFailureReason,
    message: string,
  ): ToolExecutionResult {
    this.emit(request, "denied", { reason, message });
    return this.finish(request, started, "denied", this.err(reason, message));
  }

  private limitExceeded(
    request: ToolExecutionRequest,
    started: number,
    reason: ToolFailureReason,
    details: Record<string, unknown>,
  ): ToolExecutionResult {
    this.emit(request, "limit_exceeded", { reason, ...details });
    return this.finish(
      request,
      started,
      "failure",
      this.err(reason, `execution limit exceeded (${reason})`, details),
    );
  }

  private finish(
    request: ToolExecutionRequest,
    started: number,
    status: ToolExecutionStatus,
    error: ToolExecutionError,
  ): ToolExecutionResult {
    return {
      requestId: request.requestId,
      toolId: request.toolId,
      taskId: request.taskId,
      status,
      error,
      durationMs: this.clock() - started,
      timestamp: now(),
      metadata: {},
    };
  }
}

function taskKey(request: ToolExecutionRequest): string {
  return `${request.taskId}::${request.toolId}`;
}

function agentKey(request: ToolExecutionRequest): string {
  return `${request.agentId}::${request.toolId}`;
}

function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ToolTimeoutSignal());
    }, ms);
    (timer as { unref?: () => void }).unref?.();
    Promise.resolve()
      .then(fn)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error as Error);
        },
      );
  });
}

function byteLength(value: unknown): number {
  if (value === undefined) return 0;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? 0 : new TextEncoder().encode(json).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
