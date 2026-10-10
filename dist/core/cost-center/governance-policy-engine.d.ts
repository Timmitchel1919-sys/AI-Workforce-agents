/**
 * EO-6.3 — the Governance Policy Engine: ONE structured decision point that
 * composes project authorization, budget evaluation and an optional
 * per-project provider/model allow-list.
 *
 * ALLOW != DENY != REQUIRE_APPROVAL != UNKNOWN. A caller with no way to
 * estimate cost gets `unknown`, never a silently-allowed `$0` and never a
 * denial the policy never actually asked for. Any unexpected failure inside
 * this engine fails to `unknown` with reason `GOVERNANCE_UNAVAILABLE` — it
 * NEVER defaults to `allow` just because it could not finish evaluating.
 */
import { type GovernanceDecision, type GovernanceRequest, type OperatorPrincipal } from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { BudgetEnforcer } from "./budget-enforcer.js";
import type { GovernancePolicyStore } from "./governance-policy-store.js";
export declare class GovernancePolicyEngine {
    private readonly policies;
    private readonly budget;
    private readonly clock;
    private readonly approvals?;
    private readonly audit?;
    constructor(policies: GovernancePolicyStore, budget: BudgetEnforcer, clock: () => string, approvals?: Pick<ApprovalSystem, "request" | "get"> | undefined, audit?: AuditLog | undefined);
    evaluate(principal: OperatorPrincipal, request: GovernanceRequest): Promise<GovernanceDecision>;
    private decide;
    /**
     * Returns a `require_approval` decision when one is still needed, or
     * `undefined` when an existing, valid approval already authorizes exactly
     * this request (so the caller proceeds). Never files a SECOND approval for
     * a request whose first one is still pending — only a missing, rejected or
     * expired one is replaced.
     */
    private resolveApprovalRequirement;
}
