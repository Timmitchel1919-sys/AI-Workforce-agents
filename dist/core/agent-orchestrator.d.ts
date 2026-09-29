export declare class AgentOrchestrator {
    initialize(): Promise<void>;
    dispatchAgent(agentType: string, task: any): Promise<{
        status: string;
        taskId: string;
    }>;
    awaitCompletion(taskId: string): Promise<void>;
    handleCommunication(message: any): Promise<void>;
    aggregateResults(): Promise<void>;
    runFullOrchestrationCycle(): Promise<void>;
}
