/**
 * ExecutionPlanningService — converts a structured project request into a
 * validated, auditable, versioned ExecutionPlan.
 *
 *   ProjectRequest → TaskAnalyzer → ProjectArchitect → TechnologySelector /
 *   EnvironmentRouter.evaluate → AgentQualificationRouter.evaluateCandidates →
 *   ModelCapabilityRegistry → dependency DAG → stage planner → blockers →
 *   ExecutionPlan → ExecutionPlanRepository (+ audit)
 *
 * EO-3.1 PLANS WORK. IT DOES NOT EXECUTE WORK. This service has no execution
 * path: it never runs a command, a probe, a build, a model, or a deployment.
 * An APPROVED plan only changes governance state; execution belongs to EO-4.
 *
 * BLOCKED ≠ ERROR: a project that needs an environment nobody registered is a
 * valid plan with `status: "blocked"` and structured blockers. Exceptions are
 * reserved for invalid input and invalid state transitions.
 */
import { type Approval, type ExecutionPlan, type ProjectRequest } from "../../contracts/index.js";
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
    /** Validate an untrusted request, plan it, persist version 1, audit. */
    createPlan(input: unknown, actor: PlanActor): ExecutionPlan;
    /**
     * Re-evaluate the current revision against today's registry, agents and
     * policy. Unchanged inputs return the current revision; otherwise a new
     * version is created and the previous one is superseded (never rewritten).
     */
    replan(planId: string, actor: PlanActor): {
        plan: ExecutionPlan;
        outcome: ReplanOutcome;
        previous: ExecutionPlan;
    };
    /**
     * Ask for the human approval a READY plan with protected stages needs. Uses
     * the existing ApprovalSystem; the plan never approves itself.
     */
    submitForApproval(planId: string, actor: PlanActor): ExecutionPlan;
    /**
     * Mirror an authoritative approval decision onto its plan. Returns the
     * updated plan, or `undefined` when the approval is not (or no longer) the
     * pending approval of a current plan.
     */
    applyApprovalDecision(approval: Approval, actor: PlanActor): ExecutionPlan | undefined;
    get(id: string): ExecutionPlan | undefined;
    latest(planId: string): ExecutionPlan | undefined;
    versions(planId: string): ExecutionPlan[];
    listByProject(projectId: string): ExecutionPlan[];
    private requireLatest;
    private assertProjectExists;
    private materialize;
    /** Stable hash of every input that can change a planning decision. */
    private fingerprint;
    private audit;
}
