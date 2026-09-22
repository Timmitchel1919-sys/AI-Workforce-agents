export type DeveloperMode = "plan" | "review" | "implement";
export interface DeveloperTaskDraft {
    mode?: DeveloperMode;
    objective: string;
    instructions: string;
    /** Descriptive context hints (e.g. "auth module", prior findings) — plain text, not file access. */
    context?: readonly string[];
    acceptanceCriteria?: readonly string[];
    constraints?: readonly string[];
    metadata?: Record<string, unknown>;
}
export interface DeveloperTask {
    mode: DeveloperMode;
    objective: string;
    instructions: string;
    context: readonly string[];
    acceptanceCriteria: readonly string[];
    constraints: readonly string[];
    metadata: Record<string, unknown>;
}
export type ChangeRiskLevel = "low" | "medium" | "high";
export interface ProposedChange {
    description: string;
    rationale: string;
    riskLevel: ChangeRiskLevel;
}
export type DeveloperRecommendation = "ready_for_qa" | "needs_clarification" | "blocked";
export interface DeveloperResult {
    taskId: string;
    agentId: string;
    mode: DeveloperMode;
    summary: string;
    plan: readonly string[];
    /** Proposals only — never an applied change. */
    proposedChanges: readonly ProposedChange[];
    risks: readonly string[];
    openQuestions: readonly string[];
    recommendation: DeveloperRecommendation;
    createdAt: string;
    metadata: Record<string, unknown>;
}
export declare function validateDeveloperTask(raw: unknown): DeveloperTask;
export declare function validateDeveloperResult(raw: unknown): asserts raw is DeveloperResult;
