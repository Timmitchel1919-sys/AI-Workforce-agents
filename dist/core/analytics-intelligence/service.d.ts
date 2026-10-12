import type { WorkflowInstance } from "../../contracts/autonomy.js";
import type { AgentAnalytics, AnalyticsOverview, Bottleneck, CostIntelligence, Lesson, Prediction, ProjectAnalytics, Recommendation, RecommendationArea, WhatIfResult, WhatIfScenario, WorkflowAnalytics } from "../../contracts/analytics-intelligence.js";
import { type UsageRecord } from "../../contracts/cost-center.js";
import type { ExecutionRun, RunStatus } from "../../contracts/execution-orchestration.js";
import type { Repository } from "../../contracts/persistence.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";
import type { AlertFact } from "../portfolio-intelligence/health.js";
export declare class AnalyticsError extends Error {
    readonly code: "invalid_request" | "not_found" | "invalid_state";
    constructor(code: "invalid_request" | "not_found" | "invalid_state", message: string);
}
export interface ApprovalFact {
    id: string;
    action: string;
    status: string;
    requestedAt: string;
    decidedAt?: string;
}
export interface ToolFact {
    agentId?: string;
    capability: string;
    connectorId?: string;
    projectId: string;
    outcome: string;
    at: string;
}
export interface AnalyticsPorts {
    runs(): ExecutionRun[];
    deriveRunStatus(run: ExecutionRun): RunStatus;
    usage(): UsageRecord[];
    alerts(): AlertFact[];
    approvals(): ApprovalFact[];
    toolActivity(): ToolFact[];
    connectorHealth?(): {
        connectorId: string;
        status: string;
    }[];
    autonomy(): WorkflowInstance[];
    dependentsOf?(projectId: string): string[];
    /** Store a lesson in the Knowledge layer; returns whether it was accepted. */
    remember?(lesson: Lesson): boolean;
    ledger: GovernanceLedger;
    clock: () => string;
    now: () => number;
}
export interface AnalyticsRepos {
    recommendations: Repository<Recommendation>;
    lessons: Repository<Lesson>;
}
type Access = (projectId: string) => boolean;
export declare class AnalyticsIntelligence {
    private readonly ports;
    private readonly recs;
    private readonly lessonRepo;
    constructor(repos: AnalyticsRepos, ports: AnalyticsPorts);
    private led;
    private runs;
    private tasks;
    private usage;
    agents(access: Access): AgentAnalytics[];
    workflows(access: Access, projectId?: string): WorkflowAnalytics;
    project(projectId: string, access: Access): ProjectAnalytics;
    cost(access: Access, projectId?: string): CostIntelligence;
    bottlenecks(access: Access): Bottleneck[];
    predictions(access: Access): Prediction[];
    overview(access: Access): AnalyticsOverview;
    listRecommendations(access: Access, status?: Recommendation["status"]): Recommendation[];
    recommendation(id: string, access: Access): Recommendation;
    /** Candidate recommendations derived from the data right now. */
    private candidates;
    private tokensPerTask;
    private failedRate;
    private retryShare;
    private metricValue;
    /** OBSERVE → ANALYZE → IDENTIFY → PREDICT → RECOMMEND. Idempotent: the same finding keeps one record. */
    refreshRecommendations(access: Access, by: string): Recommendation[];
    decide(id: string, decision: "APPROVED" | "REJECTED", by: string, access: Access): Recommendation;
    /** The owner records that they applied it through the normal governed channel; a fresh baseline is captured. */
    markApplied(id: string, note: string, by: string, access: Access): Recommendation;
    /** MEASURE: compare the metric now with the baseline taken when it was applied. */
    measure(id: string, access: Access): Recommendation;
    /** Reads state, writes nothing. */
    whatIf(scenario: WhatIfScenario, access: Access): WhatIfResult;
    listLessons(access: Access): Lesson[];
    /** LEARN: record durable lessons once; storage in Knowledge goes through its own write policy. */
    captureLessons(access: Access, by: string): Lesson[];
}
export type { RecommendationArea };
