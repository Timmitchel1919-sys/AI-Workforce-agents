/**
 * Policy Engine — one place where policy is evaluated.
 *
 * Precedence is by LAYER (system security → project security → architecture →
 * workflow → task → agent → user request) and then priority. Effects merge by
 * restrictiveness: a lower layer can only ADD restrictions; nothing weakens a
 * higher-layer restriction, and an ALLOW policy never relaxes anything (so
 * custom policies must restrict). Built-in system policies are immutable.
 */
import { type ActionRequest, type GovPolicy, type MatchedPolicy, type PolicyEffect, type ResourceInfo, type RiskAssessment, type TrustState } from "../../contracts/security-governance.js";
export declare const effectRank: (e: PolicyEffect) => number;
export interface EvalContext {
    request: ActionRequest;
    resource: ResourceInfo;
    environment: NonNullable<ActionRequest["environment"]>;
    risk: RiskAssessment;
    agentTrust?: TrustState;
    contentHasSecret: boolean;
    dataClass: NonNullable<ActionRequest["dataClass"]>;
    count: number;
}
export declare function matches(p: GovPolicy, ctx: EvalContext): boolean;
/** The system security policies. They cannot be edited, disabled or deleted. */
export declare const BUILTIN_POLICIES: readonly GovPolicy[];
export interface PolicyResolution {
    effect: PolicyEffect;
    matched: MatchedPolicy[];
    overruled: MatchedPolicy[];
    obligations: {
        approval: boolean;
        review: boolean;
        securityReview: boolean;
    };
    winner?: MatchedPolicy;
}
export declare function resolvePolicies(all: readonly GovPolicy[], ctx: EvalContext): PolicyResolution;
/** Baseline effect from risk alone, before any policy: LOW/MEDIUM proceed, HIGH/CRITICAL gate. */
export declare function baselineEffect(risk: RiskAssessment, action: ActionRequest["action"]): {
    effect: PolicyEffect;
    reason: string;
};
export declare function validateCustomPolicy(p: Partial<GovPolicy>): string | undefined;
