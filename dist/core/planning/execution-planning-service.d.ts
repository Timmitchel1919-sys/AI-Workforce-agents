/**
 * ExecutionPlanningService — converts a structured project request into a
 * validated, auditable, versioned ExecutionPlan.
 *
 *   ProjectRequest → TaskAnalyzer → ProjectArchitect → TechnologySelector /
 *   EnvironmentRouter.evaluate → AgentQualificationRouter.evaluateCandidates →
 *   ModelCapabilityRegistry → dependency DAG → stage planner → blockers →
 *   ExecutionPlan → ExecutionPlanStore (atomic commit) → repository view
 *   (+ audit)
 *
 * EO-3.1 PLANS WORK. IT DOES NOT EXECUTE WORK. This service has no execution
 * path: it never runs a command, a probe, a build, a model, or a deployment.
 * An APPROVED plan only changes governance state; execution belongs to EO-4.
 *
 * BLOCKED ≠ ERROR: a project that needs an environment nobody registered is a
 * valid plan with `status: "blocked"` and structured blockers. Exceptions are
 * reserved for invalid input and invalid state transitions.
 */
import { type Approval, type ExecutionPlan, type ExecutionPlanStore, type ProjectRequest } from "../../contracts/index.js";
import { type ApprovalSystem } from "../approvals/approval-system.js";
import { type AuditLog } from "../audit/audit-log.js";
import { type EnvironmentRegistry } from "../environments/environment-registry.js";
import { type AgentRegistry } from "../registry/agent-registry.js";
import { ExecutionPlanRepository } from "./execution-plan-repository.js";
import { ModelCapabilityRegistry } from "./model-capability-registry.js";
import { TechnologyCatalog } from "./technology-catalog.js";
export declare const EXECUTION_PLAN_APPROVAL_ACTION = "execution_plan.approve";
/** Bump when blocker/approval policy changes so replans detect it. */
export declare const PLANNING_POLICY_VERSION = "eo-3.1";
export interface ExecutionPlanningServiceOptions {
    environments: EnvironmentRegistry;
    agents: Pick<AgentRegistry, "list" | "get">;
    audit: AuditLog;
    approvals: ApprovalSystem;
    /** Authoritative, transactional plan storage (Firestore in production). */
    store?: ExecutionPlanStore;
    /** In-process view; defaults to an in-memory cache. */
    repository?: ExecutionPlanRepository;
    models?: ModelCapabilityRegistry;
    catalog?: TechnologyCatalog;
    isAgentEnabled?: (agentId: string) => boolean;
    /** When provided, plans can only be created for existing projects. */
    projectExists?: (projectId: string) => boolean;
    clock?: () => string;
    /** New plan-series ids. Must be globally unique in production. */
    idFactory?: () => string;
}
export interface PlanActor {
    id: string;
    correlationId?: string;
}
/** Everything a plan derives from inputs — no ids, versions or timestamps. */
export type PlanEvaluation = Pick<ExecutionPlan, "request" | "analysis" | "architecture" | "environments" | "agentRequirements" | "agents" | "models" | "dependencies" | "build" | "tests" | "security" | "deployment" | "approvalRequirements" | "blockers" | "inputsFingerprint">;
export type ReplanOutcome = "replanned" | "unchanged";
export declare class ExecutionPlanningService {
    private readonly options;
    readonly repository: ExecutionPlanRepository;
    private readonly store;
    private readonly analyzer;
    private readonly architect;
    private readonly selector;
    private readonly router;
    private readonly qualification;
    private readonly models;
    private readonly catalog;
    private readonly clock;
    private readonly idFactory;
    constructor(options: ExecutionPlanningServiceOptions);
    /** Deterministic: identical inputs and registry state → identical result. */
    evaluate(request: ProjectRequest): PlanEvaluation;
    /** Validate an untrusted request, plan it, commit version 1, audit. */
    createPlan(input: unknown, actor: PlanActor): Promise<ExecutionPlan>;
    /**
     * Re-evaluate the current revision against today's registry, agents and
     * policy. Unchanged inputs keep the current revision; otherwise version n+1
     * is committed and version n superseded in ONE atomic commit. A concurrent
     * replan loses with `PlanRevisionConflictError` instead of forking history.
     */
    replan(planId: string, actor: PlanActor): Promise<{
        plan: ExecutionPlan;
        outcome: ReplanOutcome;
        previous: ExecutionPlan;
    }>;
    /**
     * Ask for the human approval a READY plan with protected stages needs. Uses
     * the existing ApprovalSystem; the plan never approves itself. If the plan
     * changed concurrently the new approval request is expired again, so no
     * orphan approval remains.
     */
    submitForApproval(planId: string, actor: PlanActor): Promise<ExecutionPlan>;
    /**
     * Mirror an authoritative approval decision onto its plan. Returns the
     * updated plan, or `undefined` when the approval is not (or no longer) the
     * pending approval of the current revision.
     */
    applyApprovalDecision(approval: Approval, actor: PlanActor): Promise<ExecutionPlan | undefined>;
    /** Reload one project's plans from the authoritative store (fail-closed). */
    refreshProject(projectId: string): Promise<void>;
    /** Reload one plan series from the authoritative store (fail-closed). */
    refreshSeries(planId: string): Promise<void>;
    get(id: string): ExecutionPlan | undefined;
    latest(planId: string): ExecutionPlan | undefined;
    versions(planId: string): ExecutionPlan[];
    listByProject(projectId: string): ExecutionPlan[];
    private requireCurrent;
    private commitTransition;
    /** Commit; on a conflict reload the series so the caller sees fresh state. */
    private commitOrRefresh;
    private expireApproval;
    private assertProjectExists;
    private materialize;
    /** Stable hash of every input that can change a planning decision. */
    private fingerprint;
    private audit;
}
