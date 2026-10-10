import { NotFoundError, ValidationError, } from "../../contracts/index.js";
/**
 * An `AgentExecutor` that dispatches to a per-agent executor by `agent.id`.
 *
 * The orchestrator holds one `AgentExecutor`; this lets several General Agents
 * coexist behind it without any orchestrator change.
 */
export class RoutingAgentExecutor {
    executors = new Map();
    register(agentId, executor) {
        const key = agentId.trim();
        if (!key)
            throw new ValidationError("agent id is required");
        if (this.executors.has(key)) {
            throw new ValidationError(`executor already registered for agent: ${key}`);
        }
        this.executors.set(key, executor);
    }
    /**
     * Overwrites an EXISTING registration. Unlike `register`, this never
     * throws on a duplicate — it exists for exactly one purpose: a composition
     * root may bootstrap agents before every dependency (e.g. the Model
     * Router, the Cost Center) is constructed, then upgrade a specific
     * agent's executor once the rest of the runtime is ready. It is not a
     * general-purpose runtime swap and must never be reachable from a request.
     */
    replace(agentId, executor) {
        const key = agentId.trim();
        if (!key)
            throw new ValidationError("agent id is required");
        if (!this.executors.has(key)) {
            throw new NotFoundError(`no executor registered for agent "${key}" to replace`);
        }
        this.executors.set(key, executor);
    }
    has(agentId) {
        return this.executors.has(agentId.trim());
    }
    list() {
        return [...this.executors.keys()].sort();
    }
    execute(agent, task, guard, context) {
        const executor = this.executors.get(agent.id);
        if (!executor) {
            throw new NotFoundError(`no executor registered for agent "${agent.id}" ` +
                `(registered: ${this.list().join(", ") || "none"})`);
        }
        return executor.execute(agent, task, guard, context);
    }
}
