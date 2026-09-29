/** A unit of work handed to an agent. */
export interface AgentTask {
    goal: string;
}
/** A message exchanged between the orchestrator and an agent. */
export interface AgentMessage {
    type: string;
    data?: string;
}
/**
 * What a dispatch request reports back. Nothing is started by this scaffold.
 */
export interface AgentDispatch {
    status: "dispatched";
    /** Identifies the request, derived from the input — never a fixed id. */
    taskId: string;
}
export declare class AgentOrchestrator {
    initialize(): Promise<void>;
    dispatchAgent(agentType: string, task: AgentTask): Promise<AgentDispatch>;
    awaitCompletion(taskId: string): Promise<void>;
    handleCommunication(message: AgentMessage): Promise<void>;
    aggregateResults(): Promise<void>;
    runFullOrchestrationCycle(): Promise<void>;
}
