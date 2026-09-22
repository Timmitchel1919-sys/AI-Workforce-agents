export interface QAArtifact {
    id: string;
    description: string;
    /** The content to inspect, given directly — QA does not fetch anything itself. */
    content?: string;
}
export interface QATaskDraft {
    objective: string;
    acceptanceCriteria?: readonly string[];
    artifacts?: readonly QAArtifact[];
    constraints?: readonly string[];
    metadata?: Record<string, unknown>;
}
export interface QATask {
    objective: string;
    acceptanceCriteria: readonly string[];
    artifacts: readonly QAArtifact[];
    constraints: readonly string[];
    metadata: Record<string, unknown>;
}
export type QAVerdict = "pass" | "fail" | "blocked";
export interface QAFinding {
    criterion: string;
    satisfied: boolean;
    evidence: string;
}
export type DefectSeverity = "low" | "medium" | "high" | "critical";
export interface QADefect {
    id: string;
    severity: DefectSeverity;
    description: string;
    remediation: string;
}
export interface QAResult {
    taskId: string;
    agentId: string;
    verdict: QAVerdict;
    findings: readonly QAFinding[];
    defects: readonly QADefect[];
    recommendation: string;
    createdAt: string;
    metadata: Record<string, unknown>;
}
export declare function validateQATask(raw: unknown): QATask;
export declare function validateQAResult(raw: unknown): asserts raw is QAResult;
