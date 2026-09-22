import { type Agent, type AgentExecutor, type AgentFailureReason, type AgentLimits, type PermissionGuard, type Task, AgentExecutionError } from "../../contracts/index.js";
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
export declare abstract class GeneralAgent<TInput, TOutput> implements AgentExecutor {
    protected readonly deps: GeneralAgentDeps;
    protected abstract readonly agentId: string;
    protected abstract readonly role: string;
    protected abstract readonly limits: AgentLimits;
    constructor(deps: GeneralAgentDeps);
    /** Current time in ms, from the injected clock (defaults to `Date.now`). */
    protected now(): number;
    execute(agent: Agent, task: Task, guard?: PermissionGuard): Promise<unknown>;
    /** Parse + validate `task.input`. Throw `AgentExecutionError("invalid_task")`. */
    protected abstract validateInput(raw: unknown, task: Task): TInput;
    /** Assert the produced output is a valid `TOutput`. */
    protected abstract validateOutput(output: unknown): asserts output is TOutput;
    /** The domain pipeline. Must be deterministic and non-recursive. */
    protected abstract run(input: TInput, task: Task, agent: Agent, run: AgentRun, guard: PermissionGuard | undefined): Promise<TOutput>;
    /** Wrap an unknown throwable as a structured agent failure. */
    protected fail(reason: AgentFailureReason, message: string, details?: Record<string, unknown>, cause?: unknown): AgentExecutionError;
    private toAgentError;
}
/**
 * Per-execution meter + audit emitter handed to `GeneralAgent.run`.
 * All counters throw `AgentExecutionError("limit_exceeded" | "timeout")`.
 */
export declare class AgentRun {
    private readonly agentId;
    private readonly role;
    private readonly limits;
    private readonly audit;
    private readonly clock;
    private readonly task;
    private toolCalls;
    private modelCalls;
    private iterations;
    private readonly startedAt;
    constructor(agentId: string, role: string, limits: AgentLimits, audit: AuditLog, clock: () => number, task: Task);
    get elapsedMs(): number;
    /** Emit an `agent_activity` event. `kind` is a stable sub-type string. */
    activity(kind: string, data?: Record<string, unknown>): void;
    checkDeadline(): void;
    nextIteration(label: string): void;
    countToolCall(tool: string): void;
    countModelCall(label: string): void;
    get counters(): {
        toolCalls: number;
        modelCalls: number;
        iterations: number;
    };
}
