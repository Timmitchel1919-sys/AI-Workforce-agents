import type { SecurityActionContext, SecurityPolicy, SecurityPolicyDecision } from "../../contracts/security-policy.js";
export declare const DEFAULT_SECURITY_POLICIES: readonly SecurityPolicy[];
export declare class SecurityPolicyEngine {
    private readonly policies;
    constructor(policies?: readonly SecurityPolicy[]);
    evaluate(context: SecurityActionContext): SecurityPolicyDecision;
    private matchPolicies;
    private enforceInvariants;
}
