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
import { type SecurityActionContext, type SecurityPolicy, type SecurityPolicyDecision } from "../../contracts/security-policy.js";
/** The engine's view of a policy store. Pure read-only. */
export interface SecurityPolicyStore {
    list(): readonly SecurityPolicy[];
}
/** Simple in-memory store used by tests and the default-policy seed. */
export declare class InMemorySecurityPolicyStore implements SecurityPolicyStore {
    private readonly policies;
    constructor(policies: readonly SecurityPolicy[]);
    list(): readonly SecurityPolicy[];
}
export declare class SecurityPolicyEngine {
    private readonly store;
    constructor(store: SecurityPolicyStore);
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
    evaluate(context: SecurityActionContext): SecurityPolicyDecision;
}
/**
 * Default policies seeded for the engine. These are DELIBERATELY
 * conservative — they establish the shape of each decision class and
 * leave room for project-specific overrides at higher priority.
 */
export declare function defaultSecurityPolicies(now: () => string): SecurityPolicy[];
