/**
 * EO-7 — the Model Router.
 *
 * TASK → REQUIREMENTS → CANDIDATE MODELS → CAPABILITY FILTER → PROVIDER
 * AVAILABILITY → PROJECT/BUDGET POLICY → RANK/SELECT → ROUTING DECISION.
 *
 * Filtering and selection are separate: every candidate that survives
 * capability + availability filtering is THEN evaluated against the
 * project's governance policy (reusing `GovernancePolicyEngine`'s decision
 * shape — not a second policy engine) before ranking ever runs. A candidate
 * the policy denies is never ranked, no matter how well it would otherwise
 * score.
 *
 * Two entry points, same pipeline:
 *  - `route(principal, request)` — an operator-facing evaluation, gated by
 *    `GovernancePolicyEngine.evaluate` (project access + budget + allow-list,
 *    principal-authorized).
 *  - `routeInternal(request)` — the trusted path an agent's OWN execution
 *    takes (no operator principal exists at that point, the same reason
 *    `BudgetGovernedModelProvider` uses `BudgetEnforcer.evaluateInternal`
 *    rather than fabricating an "admin, allow-all" principal). It reads the
 *    SAME budget/policy stores through their existing internal, unauthorized
 *    methods (`BudgetEnforcer.evaluateInternal`, `GovernancePolicyStore.getInternal`)
 *    and applies the identical allow-list/threshold/unknown-cost logic
 *    `GovernancePolicyEngine.decide` uses — duplicated deliberately rather
 *    than refactoring that already-reviewed, security-sensitive class.
 *
 * Persists every decision (`DurableLedger`, the same primitive EO-4.8/6.2/6.3
 * already use) so a selection can be reconstructed later — who requested it,
 * what was rejected and why, what was selected, and whether it was itself a
 * governed fallback of an earlier decision.
 */
import { type Agent, type ExecutionRecordStore, type ModelRequirementProfile, type OperatorPrincipal, type RoutingDecision } from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { BudgetEnforcer } from "../cost-center/budget-enforcer.js";
import type { GovernancePolicyEngine } from "../cost-center/governance-policy-engine.js";
import type { GovernancePolicyStore } from "../cost-center/governance-policy-store.js";
import type { ModelCapabilityRegistry } from "../planning/model-capability-registry.js";
export interface RouteRequestBase {
    projectId: string;
    agentId: string;
    agent: Agent;
    requirement: ModelRequirementProfile;
    requestId: string;
    taskId?: string;
    executionSessionId?: string;
    estimatedUsd?: number;
    correlationId?: string;
    /** Set when this call is a governed RETRY of an earlier decision. */
    fallbackOf?: string;
    /** Profile ids already tried (and failed) in an earlier attempt for the SAME task — never re-offered. */
    excludeProfileIds?: readonly string[];
}
export interface RouteRequest extends RouteRequestBase {
    /** Correlates a filed approval / governance decision to THIS routing attempt, attributed to a real operator. */
    requestedBy: string;
}
export declare class ModelRouter {
    private readonly profiles;
    private readonly providers;
    private readonly governance;
    private readonly clock;
    private readonly audit?;
    /** Needed only by `routeInternal` — the trusted, principal-less execution path. */
    private readonly budgetInternal?;
    private readonly governancePoliciesInternal?;
    private readonly ledger;
    constructor(profiles: ModelCapabilityRegistry, providers: {
        has(id: string): boolean;
    }, governance: Pick<GovernancePolicyEngine, "evaluate">, clock: () => string, store?: ExecutionRecordStore, audit?: AuditLog | undefined,
    /** Needed only by `routeInternal` — the trusted, principal-less execution path. */
    budgetInternal?: Pick<BudgetEnforcer, "evaluateInternal"> | undefined, governancePoliciesInternal?: Pick<GovernancePolicyStore, "getInternal"> | undefined);
    route(principal: OperatorPrincipal, request: RouteRequest): Promise<RoutingDecision>;
    /**
     * The trusted path an agent's OWN execution takes — no operator principal
     * exists at that point. Requires the router to have been constructed with
     * `budgetInternal`/`governancePoliciesInternal`; without them (e.g. a
     * router built only for operator-facing use) this fails closed with a
     * clear error rather than silently skipping governance.
     */
    routeInternal(request: RouteRequestBase): Promise<RoutingDecision>;
    private evaluate;
    /**
     * `DurableLedger.find` is keyed only by the decision id, not by project —
     * a valid id from a DIFFERENT project must never be returned here, so the
     * project match is verified explicitly rather than left to callers to
     * remember (cross-project routing IDOR).
     */
    get(projectId: string, routingDecisionId: string): Promise<RoutingDecision | undefined>;
    listByProject(projectId: string, limit?: number): Promise<RoutingDecision[]>;
}
