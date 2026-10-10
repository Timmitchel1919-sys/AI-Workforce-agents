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
import {
  GOVERNANCE_APPROVAL_ACTION,
  ValidationError,
  operatorCanAccessProject,
  requireExecutionId,
  type GovernanceApprovalBinding,
  type GovernanceDecision,
  type GovernanceRequest,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { BudgetEnforcer } from "./budget-enforcer.js";
import {
  checkGovernanceApproval,
  requestGovernanceApproval,
} from "./governance-approval-binding.js";
import type { GovernancePolicyStore } from "./governance-policy-store.js";

export class GovernancePolicyEngine {
  constructor(
    private readonly policies: GovernancePolicyStore,
    private readonly budget: BudgetEnforcer,
    private readonly clock: () => string,
    private readonly approvals?: Pick<ApprovalSystem, "request" | "get">,
    private readonly audit?: AuditLog,
  ) {}

  async evaluate(
    principal: OperatorPrincipal,
    request: GovernanceRequest,
  ): Promise<GovernanceDecision> {
    const projectId = requireExecutionId(request.projectId, "projectId");
    // A NaN/Infinity estimate would silently dodge every threshold comparison (`NaN > x` is always
    // false) while still counting as "cost is known" — validated here too, not only at the HTTP
    // boundary, since this engine may be called directly by a future in-process caller.
    if (
      request.estimatedUsd !== undefined &&
      !Number.isFinite(request.estimatedUsd)
    ) {
      throw new ValidationError(
        "governance request.estimatedUsd must be a finite number",
      );
    }
    let decision: GovernanceDecision;
    try {
      decision = await this.decide(principal, projectId, request);
    } catch {
      // Fails to UNKNOWN, never to allow — an engine that cannot finish evaluating must never be
      // mistaken for one that evaluated and found nothing wrong.
      decision = {
        decision: "unknown",
        reasonCode: "GOVERNANCE_UNAVAILABLE",
        detail: "the governance engine could not complete this evaluation",
      };
    }
    this.audit?.record("governance_decision", {
      projectId,
      taskId: request.taskId,
      data: {
        requestId: request.requestId,
        decision: decision.decision,
        reasonCode: decision.reasonCode,
        provider: request.provider,
        model: request.model,
      },
    });
    return decision;
  }

  private async decide(
    principal: OperatorPrincipal,
    projectId: string,
    request: GovernanceRequest,
  ): Promise<GovernanceDecision> {
    if (!operatorCanAccessProject(principal, projectId)) {
      return {
        decision: "deny",
        reasonCode: "PROJECT_ACCESS_DENIED",
        detail: "not authorized for this project",
      };
    }

    const budget = await this.budget.evaluate(
      principal,
      projectId,
      request.taskId,
    );
    if (budget.status === "blocked") {
      return {
        decision: "deny",
        reasonCode: "BUDGET_LIMIT_REACHED",
        detail: budget.detail,
      };
    }

    const policy = await this.policies.get(principal, projectId);

    if (
      policy &&
      request.provider &&
      policy.allowedProviders &&
      !policy.allowedProviders.includes(request.provider.toLowerCase())
    ) {
      return {
        decision: "deny",
        reasonCode: "MODEL_NOT_ALLOWED",
        detail: `provider "${request.provider}" is not on this project's allow-list`,
      };
    }
    // Both sides normalized the SAME way `validateGovernancePolicyDraft` stores the allow-list
    // (lowercase) — comparing a mixed-case request against a lowercase-stored list without
    // lowercasing the request too would wrongly deny an explicitly allow-listed model by case alone.
    if (
      policy &&
      request.model &&
      policy.allowedModels &&
      !policy.allowedModels.includes(request.model.toLowerCase())
    ) {
      return {
        decision: "deny",
        reasonCode: "MODEL_NOT_ALLOWED",
        detail: `model "${request.model}" is not on this project's allow-list`,
      };
    }

    if (
      policy?.requireApprovalAboveUsd !== undefined &&
      request.estimatedUsd !== undefined &&
      request.estimatedUsd > policy.requireApprovalAboveUsd
    ) {
      const approvalResult = await this.resolveApprovalRequirement(
        projectId,
        request,
      );
      if (approvalResult) return approvalResult;
      // An existing, still-valid approval authorized exactly this request — proceed. The cost was
      // already known (estimatedUsd is set), so there is no remaining unknown-cost question.
      return {
        decision: "allow",
        detail:
          "allowed: an approved cost override authorizes this exact request",
      };
    }

    if (
      request.estimatedUsd === undefined &&
      !(policy?.allowUnknownCost ?? false)
    ) {
      return {
        decision: "unknown",
        reasonCode: "UNKNOWN_COST_NOT_ALLOWED",
        detail:
          "this request has no cost estimate and the project's policy does not allow proceeding on unknown cost",
      };
    }

    if (budget.status === "warning" || budget.status === "unpriced") {
      return {
        decision: "allow",
        detail: `allowed, with a governance note: ${budget.detail}`,
      };
    }
    return {
      decision: "allow",
      detail: "within all configured limits and policy",
    };
  }

  /**
   * Returns a `require_approval` decision when one is still needed, or
   * `undefined` when an existing, valid approval already authorizes exactly
   * this request (so the caller proceeds). Never files a SECOND approval for
   * a request whose first one is still pending — only a missing, rejected or
   * expired one is replaced.
   */
  private async resolveApprovalRequirement(
    projectId: string,
    request: GovernanceRequest,
  ): Promise<GovernanceDecision | undefined> {
    const binding: GovernanceApprovalBinding = {
      action: GOVERNANCE_APPROVAL_ACTION,
      projectId,
      requestId: request.requestId,
    };
    const detail = `estimated cost $${(request.estimatedUsd ?? 0).toFixed(2)} exceeds this project's approval threshold`;
    if (request.approvalId && this.approvals) {
      const problem = checkGovernanceApproval(
        this.approvals,
        request.approvalId,
        binding,
        this.clock(),
      );
      if (!problem) return undefined; // authorized — proceed
      const existing = this.approvals.get(request.approvalId);
      if (existing?.status === "requested") {
        // Still pending: report it again, never file a duplicate.
        return {
          decision: "require_approval",
          reasonCode: "APPROVAL_REQUIRED",
          detail: `${detail} (still pending)`,
          approvalId: request.approvalId,
        };
      }
      // Missing / rejected / expired / mismatched — fall through and file a fresh one.
    }
    if (!this.approvals)
      return {
        decision: "require_approval",
        reasonCode: "APPROVAL_REQUIRED",
        detail,
      };
    const approval = requestGovernanceApproval(
      this.approvals,
      binding,
      request.requestedBy,
      request.reason?.trim() || detail,
    );
    return {
      decision: "require_approval",
      reasonCode: "APPROVAL_REQUIRED",
      detail,
      approvalId: approval.id,
    };
  }
}
