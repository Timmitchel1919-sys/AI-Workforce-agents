export type ProjectManagerMode = "decompose" | "summarize";
export interface PriorTaskSummary {
    specId: string;
    agentId?: string;
    status: string;
    summary: string;
}
export interface ProjectManagerTaskDraft {
    mode?: ProjectManagerMode;
    objective: string;
    constraints?: readonly string[];
    /** Agent ids or capabilities the PM may recommend from. */
    availableAgents?: readonly string[];
    /** Supplied only in `"summarize"` mode. */
    priorResults?: readonly PriorTaskSummary[];
    metadata?: Record<string, unknown>;
}
export interface ProjectManagerTask {
    mode: ProjectManagerMode;
    objective: string;
    constraints: readonly string[];
    availableAgents: readonly string[];
    priorResults: readonly PriorTaskSummary[];
    metadata: Record<string, unknown>;
}
export interface ProjectManagerSubtask {
    id: string;
    type: string;
    description: string;
    recommendedAgentId?: string;
    recommendedCapability?: string;
    dependsOn: readonly string[];
    acceptanceCriteria: readonly string[];
    /**
     * Structured input for the subtask's own agent (e.g. a `ResearchTask`). The
     * WorkflowEngine forwards this as-is — it is never interpreted by the PM or
     * the engine, only validated by the receiving agent's own `validateInput`.
     */
    input?: unknown;
}
export type ProjectManagerRecommendation = "proceed" | "needs_approval" | "blocked";
export type WorkflowFinalStatus = "completed" | "blocked" | "failed";
export interface ProjectManagerDecision {
    mode: ProjectManagerMode;
    summary: string;
    /** Non-empty in `"decompose"` mode; empty in `"summarize"` mode. */
    subtasks: readonly ProjectManagerSubtask[];
    risks: readonly string[];
    assumptions: readonly string[];
    recommendation: ProjectManagerRecommendation;
    /** Set only in `"summarize"` mode. */
    finalStatus?: WorkflowFinalStatus;
    createdAt: string;
    metadata: Record<string, unknown>;
}
export declare function validateProjectManagerTask(raw: unknown): ProjectManagerTask;
export declare function validateProjectManagerDecision(raw: unknown): asserts raw is ProjectManagerDecision;
