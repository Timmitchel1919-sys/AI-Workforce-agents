/**
 * Project health from real signals. No percentages: a state, the evidence behind it and the
 * reasons. With no operational data the state is UNKNOWN, not "healthy".
 */
import type { ExecutionRun, OrchTask, RunStatus } from "../../contracts/execution-orchestration.js";
import type { ProjectHealth } from "../../contracts/portfolio-intelligence.js";
export interface AlertFact {
    alertId: string;
    projectId?: string;
    severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    status: string;
    event: string;
    description: string;
}
export interface HealthInput {
    projectId: string;
    runs: ExecutionRun[];
    deriveRunStatus: (run: ExecutionRun) => RunStatus;
    alerts: AlertFact[];
    /** Optional extra evidence supplied by other layers. */
    budget?: "OK" | "WARNING" | "EXCEEDED";
    overdueObjectives?: number;
    now: string;
}
export declare function tasksOf(runs: ExecutionRun[]): OrchTask[];
export declare function computeProjectHealth(input: HealthInput): ProjectHealth;
/** Second pass: a project that depends on an unhealthy one inherits a warning (never a downgrade to HEALTHY). */
export declare function applyDependencyImpact(health: ProjectHealth, deps: {
    to: string;
    weight: number;
}[], others: Map<string, ProjectHealth>): ProjectHealth;
