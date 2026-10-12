import type { ExecutionRun, RunStatus } from "../../contracts/execution-orchestration.js";
import type { UsageRecord } from "../../contracts/cost-center.js";
import type { MemoryRecord } from "../../contracts/knowledge-memory.js";
import type { Repository } from "../../contracts/persistence.js";
import { type PortfolioAnswer, type PortfolioDashboard, type PriorityRank, type ProjectDependency, type ProjectHealth, type ProjectProfile, type ProjectSummary, type ResourceClaim, type ResourceConflict, type ReusableKnowledge } from "../../contracts/portfolio-intelligence.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";
import { type AlertFact } from "./health.js";
export declare class PortfolioError extends Error {
    readonly code: "invalid_request" | "not_found" | "invalid_state" | "conflict";
    constructor(code: "invalid_request" | "not_found" | "invalid_state" | "conflict", message: string);
}
export interface ProjectFacts {
    projectId: string;
    name: string;
    repository?: string;
    branch?: string;
    stack?: string[];
    environment?: string;
    firebaseProject?: string;
    deploymentTarget?: string;
    owner?: string;
}
export interface PortfolioPorts {
    projects(): ProjectFacts[];
    runs(): ExecutionRun[];
    deriveRunStatus(run: ExecutionRun): RunStatus;
    usage(): UsageRecord[];
    alerts(): AlertFact[];
    memories(): MemoryRecord[];
    /** Platform-wide reusable assets (enabled skills / workflow templates). */
    reusableExtensions(): {
        kind: "SKILL" | "WORKFLOW";
        extensionId: string;
        name: string;
    }[];
    agentsFor(projectId: string): string[];
    budgetFor?(projectId: string): "OK" | "WARNING" | "EXCEEDED" | undefined;
    overdueObjectives?(projectId: string): number;
    ledger: GovernanceLedger;
    clock: () => string;
}
export interface PortfolioRepos {
    profiles: Repository<ProjectProfile>;
    dependencies: Repository<ProjectDependency>;
    claims: Repository<ResourceClaim>;
}
export declare class PortfolioIntelligence {
    private readonly ports;
    private readonly profiles;
    private readonly deps;
    private readonly claims;
    constructor(repos: PortfolioRepos, ports: PortfolioPorts);
    private led;
    facts(projectId: string): ProjectFacts;
    profile(projectId: string): ProjectProfile;
    setProfile(projectId: string, input: Record<string, unknown>, by: string): ProjectProfile;
    /** Archiving hides a project from the portfolio; it deletes nothing. */
    setArchived(projectId: string, archived: boolean, by: string): ProjectProfile;
    listDependencies(accessible: (id: string) => boolean): ProjectDependency[];
    addDependency(input: Record<string, unknown>, by: string, accessible: (id: string) => boolean): ProjectDependency;
    removeDependency(dependencyId: string, by: string, accessible: (id: string) => boolean): void;
    /** Is `target` reachable from `start` following from→to edges? */
    private reaches;
    listClaims(accessible: (id: string) => boolean): ResourceClaim[];
    claim(input: Record<string, unknown>, by: string, accessible: (id: string) => boolean): ResourceClaim;
    release(claimId: string, by: string, accessible: (id: string) => boolean): void;
    conflicts(accessible: (id: string) => boolean): ResourceConflict[];
    private healthMap;
    health(projectId: string, accessible: (id: string) => boolean): ProjectHealth;
    private costOf;
    summaries(accessible: (id: string) => boolean, includeArchived?: boolean): ProjectSummary[];
    summary(projectId: string, accessible: (id: string) => boolean): ProjectSummary;
    priorities(accessible: (id: string) => boolean): PriorityRank[];
    dashboard(accessible: (id: string) => boolean): PortfolioDashboard;
    private attention;
    ask(question: string, accessible: (id: string) => boolean): PortfolioAnswer;
    deploymentRisk(s: ProjectSummary, runs: ExecutionRun[], alerts: AlertFact[]): {
        projectId: string;
        name: string;
        risk: number;
        rated: boolean;
        reasons: string[];
    };
    reusableKnowledge(accessible: (id: string) => boolean): ReusableKnowledge[];
}
