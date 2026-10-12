/**
 * Security Foundation V1 — Layer 2
 *
 * Deterministic Security Policy Engine. Returns a
 * {@link SecurityPolicyDecision} for a {@link SecurityActionContext}
 * based on an explicit, enumerable list of {@link SecurityPolicy}
 * rules plus a small set of invariants that cannot be overridden by
 * any policy, store or user. The engine:
 *
 *   • NEVER executes an action.
 *   • NEVER approves an action.
 *   • NEVER mutates data.
 *   • NEVER consults an LLM.
 *   • NEVER silently downgrades risk.
 *   • NEVER defaults to `allow` for a sensitive unknown action.
 *
 * It composes with — and does NOT replace — the Governance Policy
 * Engine in `core/cost-center/governance-policy-engine.ts`. The two
 * answer different questions:
 *
 *   Governance Policy Engine  ↦ "may this spend this on that model?"
 *   Security Policy Engine    ↦ "may this attempt this action here?"
 *
 * The caller composes them in the API layer: both must agree before
 * execution proceeds, and a `deny` from either is final.
 */
import {
  DESTRUCTIVE_ACTION_PREFIXES,
  isInherentlyDestructive,
  isProhibitedAction,
  maxRisk,
  type SecurityActionContext,
  type SecurityPolicy,
  type SecurityPolicyDecision,
  type SecurityRiskLevel,
} from "../../contracts/security-policy.js";

/** The engine's view of a policy store. Pure read-only. */
export interface SecurityPolicyStore {
  list(): readonly SecurityPolicy[];
}

/** Simple in-memory store used by tests and the default-policy seed. */
export class InMemorySecurityPolicyStore implements SecurityPolicyStore {
  constructor(private readonly policies: readonly SecurityPolicy[]) {}
  list(): readonly SecurityPolicy[] {
    return this.policies;
  }
}

function matchesPattern(pattern: string, action: string): boolean {
  // `*` is a run of non-`.` characters. `**` matches everything.
  if (pattern === "*" || pattern === "**") return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    "^" +
      escaped
        .replace(/\*\*/g, "[A-Za-z0-9_.:/-]+")
        .replace(/\*/g, "[A-Za-z0-9_:/-]+") +
      "$",
  );
  return regex.test(action);
}

function policyApplies(
  policy: SecurityPolicy,
  context: SecurityActionContext,
): boolean {
  if (!policy.enabled) return false;
  if (policy.actionPatterns && policy.actionPatterns.length > 0) {
    if (!policy.actionPatterns.some((p) => matchesPattern(p, context.action)))
      return false;
  }
  if (policy.resourceTypes && policy.resourceTypes.length > 0) {
    if (!policy.resourceTypes.includes(context.targetResourceType))
      return false;
  }
  if (policy.environments && policy.environments.length > 0) {
    if (!policy.environments.includes(context.environment)) return false;
  }
  return true;
}

/**
 * Combine two decisions so the STRONGEST security requirement always
 * wins. Called repeatedly across matched policies and the inherent
 * invariants. The rules:
 *
 *   • a `deny` decision outranks every `allow` or `require_approval`
 *   • a `require_approval` outranks a plain `allow`
 *   • higher risk always wins
 *   • once `requiresMfa` / `requiresReauthentication` /
 *     `requiresTwoPersonApproval` is `true`, it cannot be cleared
 *   • `requiresApproval` cannot be cleared once set
 */
function combine(
  base: SecurityPolicyDecision,
  overlay: Partial<SecurityPolicyDecision> & { risk: SecurityRiskLevel },
  overlayPolicyId?: string,
  overlayDenies?: boolean,
): SecurityPolicyDecision {
  const nextRisk = maxRisk(base.risk, overlay.risk);
  const stillAllowed = base.allowed && !overlayDenies;
  const requiresApproval =
    base.requiresApproval || overlay.requiresApproval === true;
  const requiresReauthentication =
    base.requiresReauthentication || overlay.requiresReauthentication === true;
  const requiresMfa = base.requiresMfa || overlay.requiresMfa === true;
  const requiresTwoPersonApproval =
    base.requiresTwoPersonApproval ||
    overlay.requiresTwoPersonApproval === true;
  const ids = overlayPolicyId
    ? [...base.matchedPolicyIds, overlayPolicyId]
    : base.matchedPolicyIds;
  return {
    allowed: stillAllowed,
    action: base.action,
    risk: nextRisk,
    requiresApproval,
    requiresReauthentication,
    requiresMfa,
    requiresTwoPersonApproval,
    reason: overlay.reason ?? base.reason,
    matchedPolicyIds: ids,
    recommendedAlternative:
      overlay.recommendedAlternative ?? base.recommendedAlternative,
  };
}

export class SecurityPolicyEngine {
  constructor(private readonly store: SecurityPolicyStore) {}

  /**
   * Evaluate a context against the policy store and the hard-coded
   * invariants. Precedence, from strongest to weakest:
   *
   *   1. Prohibited actions — audit/history deletion, raw secret
   *      read/export, security-policy bypass — are DENIED here with
   *      risk `critical` before any store policy is consulted. No
   *      policy, approval or role may override.
   *   2. Explicit `deny` from any applicable policy.
   *   3. Explicit `require_approval` from any applicable policy, plus
   *      the strongest accumulated reauth/MFA/two-person requirements.
   *   4. Policy-driven risk escalation (`critical` → `low`).
   *   5. For an UNKNOWN action that looks inherently destructive —
   *      matches `DESTRUCTIVE_ACTION_PREFIXES` or `context.destructive`
   *      is true — require approval at `high` risk (or `critical` if
   *      irreversible+production) with reauth. Never silently allow.
   *   6. For an UNKNOWN non-sensitive action with no policy match —
   *      DENY with reason `SECURITY_POLICY_UNKNOWN`. The caller must
   *      define an explicit `allow` policy.
   *   7. Otherwise the matched `allow` decision stands.
   */
  evaluate(context: SecurityActionContext): SecurityPolicyDecision {
    // (1) Invariant: prohibited actions.
    if (isProhibitedAction(context.action)) {
      return {
        allowed: false,
        action: context.action,
        risk: "critical",
        requiresApproval: false,
        requiresReauthentication: true,
        requiresMfa: true,
        requiresTwoPersonApproval: true,
        reason: `SECURITY_POLICY_INVARIANT: '${context.action}' is permanently prohibited`,
        matchedPolicyIds: ["__invariant_prohibited__"],
        recommendedAlternative:
          "Use the lifecycle-appropriate alternative (retention, archive, soft delete).",
      };
    }

    const applicable = this.store
      .list()
      .filter((p) => policyApplies(p, context))
      .slice()
      .sort((a, b) => a.priority - b.priority);

    const baseAllow: SecurityPolicyDecision = {
      allowed: true,
      action: context.action,
      risk: "low",
      requiresApproval: false,
      requiresReauthentication: false,
      requiresMfa: false,
      requiresTwoPersonApproval: false,
      reason: "SECURITY_POLICY_ALLOWED",
      matchedPolicyIds: [],
    };

    let decision = baseAllow;

    // (2) & (3) Fold in explicit matches.
    for (const policy of applicable) {
      const overlay = {
        risk: policy.risk,
        requiresApproval:
          policy.effect === "require_approval" ? true : undefined,
        requiresReauthentication: policy.requiresReauthentication,
        requiresMfa: policy.requiresMfa,
        requiresTwoPersonApproval: policy.requiresTwoPersonApproval,
        reason: policy.reason,
      };
      decision = combine(
        decision,
        overlay,
        policy.id,
        policy.effect === "deny",
      );
    }

    // (5) Inherently destructive unknowns.
    const hadDenyOrApproval = applicable.some((p) => p.effect !== "allow");
    const looksDestructive =
      context.destructive ||
      DESTRUCTIVE_ACTION_PREFIXES.some((p) => context.action.startsWith(p)) ||
      isInherentlyDestructive(context.action);
    if (looksDestructive && !hadDenyOrApproval) {
      const risk: SecurityRiskLevel =
        context.irreversible && context.production ? "critical" : "high";
      decision = combine(
        decision,
        {
          risk,
          requiresApproval: true,
          requiresReauthentication: true,
          requiresMfa: context.production ? true : undefined,
          requiresTwoPersonApproval: risk === "critical" ? true : undefined,
          reason:
            "SECURITY_POLICY_DESTRUCTIVE_UNKNOWN: inherently destructive action requires approval",
          recommendedAlternative:
            "Prefer archive, soft-delete, disable, deprecate or rollback over permanent deletion.",
        },
        "__invariant_destructive_unknown__",
      );
    }

    // (6) Unknown non-sensitive action with no match: fail closed.
    if (applicable.length === 0 && !looksDestructive) {
      return {
        allowed: false,
        action: context.action,
        risk: "medium",
        requiresApproval: false,
        requiresReauthentication: false,
        requiresMfa: false,
        requiresTwoPersonApproval: false,
        reason:
          "SECURITY_POLICY_UNKNOWN: no explicit policy matched; action is denied by default",
        matchedPolicyIds: [],
      };
    }

    return decision;
  }
}

/**
 * Default policies seeded for the engine. These are DELIBERATELY
 * conservative — they establish the shape of each decision class and
 * leave room for project-specific overrides at higher priority.
 */
export function defaultSecurityPolicies(now: () => string): SecurityPolicy[] {
  const ts = now();
  const base = { createdAt: ts, updatedAt: ts, enabled: true };
  return [
    {
      ...base,
      id: "sec.a.read.allow",
      name: "A — authorized project read",
      priority: 100,
      actionPatterns: ["read.*", "list.*", "describe.*"],
      risk: "low",
      effect: "allow",
      reason: "POLICY_A: normal authorized project reads are low-risk",
    },
    {
      ...base,
      id: "sec.b.standard-mutation.allow",
      name: "B — standard mutation",
      priority: 110,
      actionPatterns: ["write.*", "update.*", "create.*", "upsert.*"],
      risk: "medium",
      effect: "allow",
      reason:
        "POLICY_B: standard mutations are governed by capability + project scope",
    },
    {
      ...base,
      id: "sec.c.production-deployment",
      name: "C — production deployment",
      priority: 50,
      actionPatterns: ["deploy_release", "release.*"],
      environments: ["production"],
      risk: "high",
      effect: "require_approval",
      requiresReauthentication: true,
      reason:
        "POLICY_C: production deployment requires governed release approval",
    },
    {
      ...base,
      id: "sec.d.security-policy-change",
      name: "D — security policy change",
      priority: 20,
      actionPatterns: ["security_policy.*", "policy.security.*"],
      risk: "high",
      effect: "require_approval",
      requiresReauthentication: true,
      requiresMfa: true,
      reason:
        "POLICY_D: security policy mutation requires manage_security_policy + reauth + MFA",
    },
    {
      ...base,
      id: "sec.e.identity-change",
      name: "E — identity / access change",
      priority: 30,
      actionPatterns: [
        "operator.role.*",
        "operator.access.*",
        "identity.security.*",
      ],
      risk: "high",
      effect: "require_approval",
      requiresReauthentication: true,
      reason:
        "POLICY_E: identity and access changes require reauth and preserve last-admin invariants",
    },
    {
      ...base,
      id: "sec.f.secret-reference-change",
      name: "F — secret reference change",
      priority: 25,
      actionPatterns: ["secret.reference.*", "secret.metadata.*"],
      risk: "high",
      effect: "require_approval",
      requiresReauthentication: true,
      reason:
        "POLICY_F: secret-reference mutation is governed; raw secret export is prohibited elsewhere",
    },
    {
      ...base,
      id: "sec.g.agent-security-change",
      name: "G — agent security change",
      priority: 40,
      actionPatterns: ["agent.security.*", "agent.privilege.*"],
      risk: "high",
      effect: "require_approval",
      requiresReauthentication: true,
      reason:
        "POLICY_G: agent-security mutation and privilege expansion require approval",
    },
    {
      ...base,
      id: "sec.h.destructive",
      name: "H — destructive action",
      priority: 10,
      actionPatterns: [
        "delete.*",
        "destroy.*",
        "purge.*",
        "revoke.*",
        "terminate.*",
        "drop.*",
        "permanent.*",
      ],
      risk: "high",
      effect: "require_approval",
      requiresReauthentication: true,
      reason:
        "POLICY_H: destructive actions require the Destructive Action Approval Gate",
    },
    {
      ...base,
      id: "sec.h.destructive-prod",
      name: "H' — permanent production deletion",
      priority: 5,
      actionPatterns: ["delete.*", "destroy.*", "purge.*", "permanent.*"],
      environments: ["production"],
      risk: "critical",
      effect: "require_approval",
      requiresReauthentication: true,
      requiresMfa: true,
      requiresTwoPersonApproval: true,
      reason:
        "POLICY_H': permanent production deletion is critical and requires two-person approval + MFA",
    },
    // POLICIES I and J (audit / security event history deletion) are
    // enforced by `isProhibitedAction` as hard invariants above — no
    // store policy may override them.
  ];
}
