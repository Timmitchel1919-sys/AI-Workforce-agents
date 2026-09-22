import { AgentExecutionError, } from "../../contracts/index.js";
export class GeneralAgent {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /** Current time in ms, from the injected clock (defaults to `Date.now`). */
    now() {
        return (this.deps.clock ?? Date.now)();
    }
    async execute(agent, task, guard) {
        const run = new AgentRun(this.agentId, this.role, this.limits, this.deps.audit, this.deps.clock ?? Date.now, task);
        run.activity("task_received", { taskType: task.type });
        try {
            const input = this.validateInput(task.input, task);
            run.activity("started", {});
            const output = await this.run(input, task, agent, run, guard);
            this.validateOutput(output);
            run.activity("result_validated", {});
            run.activity("completed", { elapsedMs: run.elapsedMs });
            return output;
        }
        catch (error) {
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
    /** Wrap an unknown throwable as a structured agent failure. */
    fail(reason, message, details = {}, cause) {
        return new AgentExecutionError(this.agentId, reason, message, details, cause);
    }
    toAgentError(error) {
        if (error instanceof AgentExecutionError)
            return error;
        const message = error instanceof Error ? error.message : String(error);
        return new AgentExecutionError(this.agentId, "internal_error", message, {}, error);
    }
}
/**
 * Per-execution meter + audit emitter handed to `GeneralAgent.run`.
 * All counters throw `AgentExecutionError("limit_exceeded" | "timeout")`.
 */
export class AgentRun {
    agentId;
    role;
    limits;
    audit;
    clock;
    task;
    toolCalls = 0;
    modelCalls = 0;
    iterations = 0;
    startedAt;
    constructor(agentId, role, limits, audit, clock, task) {
        this.agentId = agentId;
        this.role = role;
        this.limits = limits;
        this.audit = audit;
        this.clock = clock;
        this.task = task;
        this.startedAt = clock();
    }
    get elapsedMs() {
        return this.clock() - this.startedAt;
    }
    /** Emit an `agent_activity` event. `kind` is a stable sub-type string. */
    activity(kind, data = {}) {
        this.audit.record("agent_activity", {
            taskId: this.task.id,
            agentId: this.agentId,
            projectId: this.task.projectId,
            data: { kind, role: this.role, ...data },
        });
    }
    checkDeadline() {
        if (this.elapsedMs > this.limits.timeoutMs) {
            throw new AgentExecutionError(this.agentId, "timeout", `execution exceeded ${this.limits.timeoutMs}ms`, { elapsedMs: this.elapsedMs });
        }
    }
    nextIteration(label) {
        this.iterations += 1;
        if (this.iterations > this.limits.maxIterations) {
            throw new AgentExecutionError(this.agentId, "limit_exceeded", `exceeded ${this.limits.maxIterations} iterations at "${label}"`, { limit: this.limits.maxIterations, kind: "iterations" });
        }
    }
    countToolCall(tool) {
        this.toolCalls += 1;
        if (this.toolCalls > this.limits.maxToolCalls) {
            throw new AgentExecutionError(this.agentId, "limit_exceeded", `exceeded ${this.limits.maxToolCalls} tool calls (at "${tool}")`, { limit: this.limits.maxToolCalls, kind: "tool_calls" });
        }
    }
    countModelCall(label) {
        this.modelCalls += 1;
        if (this.modelCalls > this.limits.maxModelCalls) {
            throw new AgentExecutionError(this.agentId, "limit_exceeded", `exceeded ${this.limits.maxModelCalls} model calls (at "${label}")`, { limit: this.limits.maxModelCalls, kind: "model_calls" });
        }
    }
    get counters() {
        return {
            toolCalls: this.toolCalls,
            modelCalls: this.modelCalls,
            iterations: this.iterations,
        };
    }
}
