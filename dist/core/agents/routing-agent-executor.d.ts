import { type Agent, type AgentExecutionContext, type AgentExecutor, type PermissionGuard, type Task } from "../../contracts/index.js";
/**
 * An `AgentExecutor` that dispatches to a per-agent executor by `agent.id`.
 *
 * The orchestrator holds one `AgentExecutor`; this lets several General Agents
 * coexist behind it without any orchestrator change.
 */
export declare class RoutingAgentExecutor implements AgentExecutor {
    private readonly executors;
    register(agentId: string, executor: AgentExecutor): void;
    /**
     * Overwrites an EXISTING registration. Unlike `register`, this never
     * throws on a duplicate — it exists for exactly one purpose: a composition
     * root may bootstrap agents before every dependency (e.g. the Model
     * Router, the Cost Center) is constructed, then upgrade a specific
     * agent's executor once the rest of the runtime is ready. It is not a
     * general-purpose runtime swap and must never be reachable from a request.
     */
    replace(agentId: string, executor: AgentExecutor): void;
    has(agentId: string): boolean;
    list(): string[];
    execute(agent: Agent, task: Task, guard?: PermissionGuard, context?: AgentExecutionContext): Promise<unknown>;
}
