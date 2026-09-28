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
import { MODEL_PRICES, ValidationError, requireExecutionId, } from "../../contracts/index.js";
import { DurableLedger } from "../release/durable-ledger.js";
import { createId } from "../shared.js";
const KIND = "routing_decision";
function mapDenyReason(reasonCode) {
    switch (reasonCode) {
        case "BUDGET_LIMIT_REACHED":
            return "BUDGET_EXCEEDED";
        case "MODEL_NOT_ALLOWED":
            return "PROJECT_POLICY_DENIED";
        case "PROJECT_ACCESS_DENIED":
            return "SECURITY_POLICY_DENIED";
        default:
            return "PROJECT_POLICY_DENIED";
    }
}
export class ModelRouter {
    profiles;
    providers;
    governance;
    clock;
    audit;
    budgetInternal;
    governancePoliciesInternal;
    ledger;
    constructor(profiles, providers, governance, clock, store, audit, 
    /** Needed only by `routeInternal` — the trusted, principal-less execution path. */
    budgetInternal, governancePoliciesInternal) {
        this.profiles = profiles;
        this.providers = providers;
        this.governance = governance;
        this.clock = clock;
        this.audit = audit;
        this.budgetInternal = budgetInternal;
        this.governancePoliciesInternal = governancePoliciesInternal;
        this.ledger = new DurableLedger(store, clock);
    }
    async route(principal, request) {
        return this.evaluate(request, (profile) => this.governance.evaluate(principal, {
            projectId: request.projectId,
            requestId: `${request.requestId}:${profile.id}`,
            requestedBy: request.requestedBy,
            taskId: request.taskId,
            provider: profile.providerId,
            model: profile.model,
            estimatedUsd: request.estimatedUsd,
        }));
    }
    /**
     * The trusted path an agent's OWN execution takes — no operator principal
     * exists at that point. Requires the router to have been constructed with
     * `budgetInternal`/`governancePoliciesInternal`; without them (e.g. a
     * router built only for operator-facing use) this fails closed with a
     * clear error rather than silently skipping governance.
     */
    async routeInternal(request) {
        if (!this.budgetInternal || !this.governancePoliciesInternal) {
            throw new Error("ModelRouter.routeInternal requires budgetInternal and governancePoliciesInternal to be configured");
        }
        // Same NaN/Infinity guard EO-6.3 required of the principal path: NaN would silently pass every
        // `> threshold` comparison below while still counting as "cost is known", bypassing approval.
        if (request.estimatedUsd !== undefined &&
            !Number.isFinite(request.estimatedUsd)) {
            throw new ValidationError("routing request.estimatedUsd must be a finite number");
        }
        return this.evaluate(request, async (profile) => {
            const policy = await this.governancePoliciesInternal.getInternal(request.projectId);
            // Check order MUST mirror `GovernancePolicyEngine.decide` exactly (budget before the
            // provider/model allow-list): the same simultaneous-violation state must report the SAME
            // reasonCode regardless of which entry point (principal or internal) evaluated it — a
            // correctness-review finding, since a caller may reasonably branch on `reasonCode`, and
            // "which check ran first" is an implementation detail, never a reportable fact.
            const budget = await this.budgetInternal.evaluateInternal(request.projectId, request.taskId);
            if (budget.status === "blocked") {
                return {
                    decision: "deny",
                    reasonCode: "BUDGET_LIMIT_REACHED",
                    detail: budget.detail,
                };
            }
            if (policy?.allowedProviders &&
                !policy.allowedProviders.includes(profile.providerId.toLowerCase())) {
                return {
                    decision: "deny",
                    reasonCode: "MODEL_NOT_ALLOWED",
                    detail: `provider "${profile.providerId}" is not on this project's allow-list`,
                };
            }
            if (policy?.allowedModels &&
                profile.model &&
                !policy.allowedModels.includes(profile.model.toLowerCase())) {
                return {
                    decision: "deny",
                    reasonCode: "MODEL_NOT_ALLOWED",
                    detail: `model "${profile.model}" is not on this project's allow-list`,
                };
            }
            if (policy?.requireApprovalAboveUsd !== undefined &&
                request.estimatedUsd !== undefined &&
                request.estimatedUsd > policy.requireApprovalAboveUsd) {
                return {
                    decision: "require_approval",
                    reasonCode: "APPROVAL_REQUIRED",
                    detail: `estimated cost $${request.estimatedUsd.toFixed(2)} exceeds this project's approval threshold`,
                };
            }
            if (request.estimatedUsd === undefined &&
                !(policy?.allowUnknownCost ?? false)) {
                return {
                    decision: "unknown",
                    reasonCode: "UNKNOWN_COST_NOT_ALLOWED",
                    detail: "this request has no cost estimate and the project's policy does not allow proceeding on unknown cost",
                };
            }
            return {
                decision: "allow",
                detail: "within all configured limits and policy",
            };
        });
    }
    async evaluate(request, checkGovernance) {
        const projectId = requireExecutionId(request.projectId, "projectId");
        const createdAt = this.clock();
        const routingDecisionId = createId("routing");
        const excluded = new Set(request.excludeProfileIds ?? []);
        const allProfiles = this.profiles.list().filter((p) => !excluded.has(p.id));
        // Case-insensitive on BOTH sides, consistently — matching a mixed-case restriction against a
        // differently-cased but identical provider/model id must never wrongly filter it out (the same
        // bug class EO-6.3 fixed for the governance allow-list's model comparison).
        const restrictedProviders = request.requirement.providerRestrictions?.map((p) => p.trim().toLowerCase());
        const restrictedModels = request.requirement.modelRestrictions?.map((m) => m.trim().toLowerCase());
        const inScope = allProfiles.filter((p) => (!restrictedProviders ||
            restrictedProviders.includes(p.providerId.toLowerCase())) &&
            (!restrictedModels ||
                p.model === undefined ||
                restrictedModels.includes(p.model.toLowerCase())));
        const eligibility = this.profiles.eligibility(request.agent, request.requirement.requiredCapabilities);
        const eligibleIds = new Set(eligibility.eligibleProfileIds);
        const candidateModels = [];
        const rejectedCandidates = [];
        const survivors = [];
        const pending = [];
        for (const profile of inScope) {
            if (!eligibleIds.has(profile.id)) {
                rejectedCandidates.push({
                    profileId: profile.id,
                    providerId: profile.providerId,
                    model: profile.model,
                    reasonCode: "CAPABILITY_MISMATCH",
                    detail: `missing capabilities: ${eligibility.missingCapabilities.join(", ") || "capability requirement not satisfied"}`,
                });
                continue;
            }
            const available = this.providers.has(profile.providerId);
            candidateModels.push({
                profileId: profile.id,
                providerId: profile.providerId,
                model: profile.model,
                status: available ? "available" : "unavailable",
            });
            if (!available) {
                rejectedCandidates.push({
                    profileId: profile.id,
                    providerId: profile.providerId,
                    model: profile.model,
                    reasonCode: "PROVIDER_UNAVAILABLE",
                    detail: `no "${profile.providerId}" provider is registered in this deployment`,
                });
                continue;
            }
            const decision = await checkGovernance(profile);
            if (decision.decision === "allow") {
                survivors.push({ profile, governance: decision });
            }
            else if (decision.decision === "deny") {
                rejectedCandidates.push({
                    profileId: profile.id,
                    providerId: profile.providerId,
                    model: profile.model,
                    reasonCode: mapDenyReason(decision.reasonCode),
                    detail: decision.detail,
                });
            }
            else {
                // require_approval / unknown: not disqualified, but not selectable THIS round either.
                pending.push({ profile, governance: decision });
            }
        }
        let selected;
        if (survivors.length > 0) {
            selected = rank(survivors, request.requirement);
        }
        const decision = {
            routingDecisionId,
            projectId,
            taskId: request.taskId,
            executionSessionId: request.executionSessionId,
            agentId: request.agentId,
            requirements: request.requirement,
            candidateModels,
            rejectedCandidates,
            selectedProvider: selected?.profile.providerId,
            selectedModel: selected?.profile.model,
            reasonCodes: selected
                ? []
                : [...new Set(rejectedCandidates.map((r) => r.reasonCode))],
            costEstimate: request.estimatedUsd !== undefined
                ? { priced: true, amountUsd: request.estimatedUsd }
                : {
                    priced: false,
                    reason: "no pre-execution cost estimate was supplied",
                },
            policyDecision: selected?.governance ?? pending[0]?.governance,
            fallbackPolicy: "governed",
            fallbackOf: request.fallbackOf,
            fallbackUsed: request.fallbackOf !== undefined,
            createdAt,
            correlationId: request.correlationId,
        };
        await this.ledger.save(KIND, routingDecisionId, projectId, createdAt, decision, "create");
        this.audit?.record(decision.selectedModel !== undefined ||
            decision.selectedProvider !== undefined
            ? "routing_decision_made"
            : "routing_no_candidate", {
            projectId,
            taskId: request.taskId,
            agentId: request.agentId,
            data: {
                routingDecisionId,
                selectedProvider: decision.selectedProvider,
                selectedModel: decision.selectedModel,
                reasonCodes: decision.reasonCodes,
                fallbackUsed: decision.fallbackUsed,
            },
        });
        return decision;
    }
    /**
     * `DurableLedger.find` is keyed only by the decision id, not by project —
     * a valid id from a DIFFERENT project must never be returned here, so the
     * project match is verified explicitly rather than left to callers to
     * remember (cross-project routing IDOR).
     */
    async get(projectId, routingDecisionId) {
        const id = requireExecutionId(projectId, "projectId");
        const decision = await this.ledger.find(KIND, routingDecisionId);
        return decision && decision.projectId === id ? decision : undefined;
    }
    async listByProject(projectId, limit = 50) {
        const id = requireExecutionId(projectId, "projectId");
        return this.ledger.list(KIND, id, limit, (d) => d.routingDecisionId);
    }
}
/**
 * Multi-factor selection (never "always the strongest model"). Every
 * dimension used here is AUTHORITATIVE data already on hand — never a
 * fabricated quality/latency score:
 *  - `cost_efficient` prefers a lower declared price (from the SAME price
 *    table the Cost Center uses); a profile with no pinned model (so no
 *    price can be looked up) sorts after any priced one.
 *  - `quality_first` / `high_assurance` prefer more of the requirement's
 *    PREFERRED (not required — those are already guaranteed) capabilities.
 *  - `low_latency` and `balanced` (and no profile given) have no
 *    authoritative signal to rank by yet, so they fall back to the same
 *    deterministic tie-break everything else uses — documented here rather
 *    than faking a latency number.
 * The final tie-break is always the profile id, so routing is reproducible
 * for the same inputs.
 */
function rank(survivors, requirement) {
    const profileWeight = (p) => {
        if (requirement.routingProfile === "cost_efficient") {
            // MODEL_PRICES keys are lowercase by convention; lowercasing here too means a differently-cased
            // model id still finds its real price instead of silently sorting as unpriced.
            const price = p.model ? MODEL_PRICES[p.model.toLowerCase()] : undefined;
            return price
                ? price.inputPerMillionUsd + price.outputPerMillionUsd
                : Number.POSITIVE_INFINITY;
        }
        if (requirement.routingProfile === "quality_first" ||
            requirement.routingProfile === "high_assurance") {
            const preferred = requirement.preferredCapabilities ?? [];
            const matched = preferred.filter((c) => p.capabilities.includes(c)).length;
            return -matched; // more matches => lower (better) weight
        }
        return 0;
    };
    return [...survivors].sort((a, b) => profileWeight(a.profile) - profileWeight(b.profile) ||
        a.profile.id.localeCompare(b.profile.id))[0];
}
