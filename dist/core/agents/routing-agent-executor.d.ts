import { type Agent, type AgentExecutor, type PermissionGuard, type Task } from "../../contracts/index.js";
/**
 * An `AgentExecutor` that dispatches to a per-agent executor by `agent.id`.
 *
 * The orchestrator holds one `AgentExecutor`; this lets several General Agents
 * coexist behind it without any orchestrator change.
 */
export declare class RoutingAgentExecutor implements AgentExecutor {
    private readonly executors;
    register(agentId: string, executor: AgentExecutor): void;
    has(agentId: string): boolean;
    list(): string[];
    execute(agent: Agent, task: Task, guard?: PermissionGuard): Promise<unknown>;
}
