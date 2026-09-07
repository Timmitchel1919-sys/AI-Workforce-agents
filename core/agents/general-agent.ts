import {
  type Agent,
  type AgentExecutor,
  type AgentFailureReason,
  type AgentLimits,
  type PermissionGuard,
  type Task,
  AgentExecutionError,
} from "../../contracts/index.js";
import { AuditLog } from "../audit/audit-log.js";

/**
 * Reusable base for General Agents (Research, and later Project Manager,
 * Developer, ...).
 *
 * It owns the invariant parts of every agent execution:
 *
 *  - a fixed, non-recursive pipeline (`validateInput → run → validateOutput`)
 *  - hard limits (iterations / tool calls / model calls / wall-clock)
 *  - one structured failure type (`AgentExecutionError`) — never a partial or
 *    unstructured result
 *  - `agent_activity` audit events at each phase
 *
 * Subclasses implement only the domain steps. `run` receives an
 * {@link AgentRun} that meters limits and emits audit events; it must call the
 * metering methods before each tool/model call.
 */
export interface GeneralAgentDeps {
  audit: AuditLog;
  /** Injectable clock (ms). Defaults to `Date.now`. */
  clock?: () => number;
}

export abstract class GeneralAgent<TInput, TOutput> implements AgentExecutor {
  protected abstract readonly agentId: string;
  protected abstract readonly role: string;
  protected abstract readonly limits: AgentLimits;

  constructor(protected readonly deps: GeneralAgentDeps) {}

  /** Current time in ms, from the injected clock (defaults to `Date.now`). */
  protected now(): number {
    return (this.deps.clock ?? Date.now)();
  }

  async execute(
    agent: Agent,
    task: Task,
    guard?: PermissionGuard,
  ): Promise<unknown> {
    const run = new AgentRun(
      this.agentId,
      this.role,
      this.limits,
      this.deps.audit,
      this.deps.clock ?? Date.now,
      task,
    );
    run.activity("task_received", { taskType: task.type });

    try {
      const input = this.validateInput(task.input, task);
      run.activity("started", {});
      const output = await this.run(input, task, agent, run, guard);
      this.validateOutput(output);
      run.activity("result_validated", {});
      run.activity("completed", { elapsedMs: run.elapsedMs });
      return output;
    } catch (error) {
      const failure = this.toAgentError(error);
      run.activity("failed", {
        reason: failure.reason,
        error: failure.message,
        details: failure.details,
        elapsedMs: run.elapsedMs,
      });
      throw failure;
    }
  }

  /** Parse + validate `task.input`. Throw `AgentExecutionError("invalid_task")`. */
  protected abstract validateInput(raw: unknown, task: Task): TInput;

  /** Assert the produced output is a valid `TOutput`. */
  protected abstract validateOutput(output: unknown): asserts output is TOutput;

  /** The domain pipeline. Must be deterministic and non-recursive. */
  protected abstract run(
    input: TInput,
    task: Task,
    agent: Agent,
    run: AgentRun,
    guard: PermissionGuard | undefined,
  ): Promise<TOutput>;

  /** Wrap an unknown throwable as a structured agent failure. */
  protected fail(
    reason: AgentFailureReason,
    message: string,
    details: Record<string, unknown> = {},
    cause?: unknown,
  ): AgentExecutionError {
    return new AgentExecutionError(
      this.agentId,
      reason,
      message,
      details,
      cause,
    );
  }

  private toAgentError(error: unknown): AgentExecutionError {
    if (error instanceof AgentExecutionError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new AgentExecutionError(
      this.agentId,
      "internal_error",
      message,
      {},
      error,
    );
  }
}

/**
 * Per-execution meter + audit emitter handed to `GeneralAgent.run`.
 * All counters throw `AgentExecutionError("limit_exceeded" | "timeout")`.
 */
export class AgentRun {
  private toolCalls = 0;
  private modelCalls = 0;
  private iterations = 0;
  private readonly startedAt: number;

  constructor(
    private readonly agentId: string,
    private readonly role: string,
    private readonly limits: AgentLimits,
    private readonly audit: AuditLog,
    private readonly clock: () => number,
    private readonly task: Task,
  ) {
    this.startedAt = clock();
  }

  get elapsedMs(): number {
    return this.clock() - this.startedAt;
  }

  /** Emit an `agent_activity` event. `kind` is a stable sub-type string. */
  activity(kind: string, data: Record<string, unknown> = {}): void {
    this.audit.record("agent_activity", {
      taskId: this.task.id,
      agentId: this.agentId,
      projectId: this.task.projectId,
      data: { kind, role: this.role, ...data },
    });
  }

  checkDeadline(): void {
    if (this.elapsedMs > this.limits.timeoutMs) {
      throw new AgentExecutionError(
        this.agentId,
        "timeout",
        `execution exceeded ${this.limits.timeoutMs}ms`,
        { elapsedMs: this.elapsedMs },
      );
    }
  }

  nextIteration(label: string): void {
    this.iterations += 1;
    if (this.iterations > this.limits.maxIterations) {
      throw new AgentExecutionError(
        this.agentId,
        "limit_exceeded",
        `exceeded ${this.limits.maxIterations} iterations at "${label}"`,
        { limit: this.limits.maxIterations, kind: "iterations" },
      );
    }
  }

  countToolCall(tool: string): void {
    this.toolCalls += 1;
    if (this.toolCalls > this.limits.maxToolCalls) {
      throw new AgentExecutionError(
        this.agentId,
        "limit_exceeded",
        `exceeded ${this.limits.maxToolCalls} tool calls (at "${tool}")`,
        { limit: this.limits.maxToolCalls, kind: "tool_calls" },
      );
    }
  }

  countModelCall(label: string): void {
    this.modelCalls += 1;
    if (this.modelCalls > this.limits.maxModelCalls) {
      throw new AgentExecutionError(
        this.agentId,
        "limit_exceeded",
        `exceeded ${this.limits.maxModelCalls} model calls (at "${label}")`,
        { limit: this.limits.maxModelCalls, kind: "model_calls" },
      );
    }
  }

  get counters(): {
    toolCalls: number;
    modelCalls: number;
    iterations: number;
  } {
    return {
      toolCalls: this.toolCalls,
      modelCalls: this.modelCalls,
      iterations: this.iterations,
    };
  }
}
