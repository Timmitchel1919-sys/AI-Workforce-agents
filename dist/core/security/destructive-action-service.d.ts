import { type Approval, type OperatorPrincipal, type Repository } from "../../contracts/index.js";
import { type DestructiveActionRequest, type DestructiveActionRequestDraft, type DestructiveActionRequestRevision, type DestructiveApprovalDecision, type SecurityMfaEvidence, type SecurityReauthenticationEvidence } from "../../contracts/destructive-action.js";
import { type SecurityPolicyDecision } from "../../contracts/security-policy.js";
import { ApprovalSystem } from "../approvals/approval-system.js";
import type { SecurityPolicyEngine } from "./security-policy-engine.js";
/**
 * Narrow interface the service uses to re-resolve historical approvers
 * at execution time. The implementation should reuse the authoritative
 * `OperatorAccount` / access-control repository — this must NOT become
 * a second identity system. Only ACTIVE operator principals may be
 * returned; otherwise `undefined`.
 */
export interface DestructiveApproverResolver {
    resolve(operatorId: string): OperatorPrincipal | undefined;
}
/**
 * Trusted MFA / reauth evidence passed to the executor by the API
 * middleware (Layer 5). The service never fabricates this; raw client
 * flags must not flow through.
 */
export interface SecurityExecutionEvidence {
    mfa?: SecurityMfaEvidence;
    reauth?: SecurityReauthenticationEvidence;
}
export interface AssertApprovedInput {
    requestId: string;
    principal: OperatorPrincipal;
    actionType: string;
    targetResourceType: string;
    targetResourceId: string;
    environment: "local" | "test" | "staging" | "production";
    projectId?: string;
    /**
     * Trusted boundary evidence. Layer 3 validates shape + freshness; the
     * authoritative verifier lives in Layer 5. Required when the current
     * (or historical, strongest-wins merged) policy demands them.
     */
    evidence?: SecurityExecutionEvidence;
}
/**
 * Target fingerprint. Covers the full material-identity tuple PLUS
 * `revision`, so an approval bound to revision 1 cannot authorize
 * revision 2 even if every other field happened to match.
 */
export declare function computeTargetFingerprint(input: {
    action: string;
    actionType: string;
    targetResourceType: string;
    targetResourceId: string;
    environment: string;
    projectId?: string;
    production: boolean;
    irreversible: boolean;
    revision: number;
}): string;
/**
 * Policy fingerprint. Captures the EFFECT-level shape of the decision
 * (allowed / risk / requirements / matched ids), not the surrounding
 * reason text. Two decisions with the same fingerprint are "materially
 * equivalent" even if their internal reason strings differ.
 */
export declare function computePolicyFingerprint(decision: SecurityPolicyDecision): string;
/**
 * Combine two policy decisions so the strongest requirement in either
 * one carries. Used at execution time to prevent a WEAKENED current
 * policy from silently removing requirements that applied when the
 * approvers decided. A STRICTER current policy is handled separately
 * (we re-require reapproval under those).
 */
export declare function strongestOf(a: SecurityPolicyDecision, b: SecurityPolicyDecision): SecurityPolicyDecision;
/**
 * Returns true iff `current` is materially STRICTER than `approved`
 * (new risk tier higher, newly requires approval / MFA / reauth /
 * two-person, or newly disallowed). We then force reapproval instead
 * of merging silently.
 */
export declare function policyIsStricter(approved: SecurityPolicyDecision, current: SecurityPolicyDecision): boolean;
/**
 * Observer hook so the composition root can emit canonical security
 * events for drift / block decisions without this file depending on
 * the canonical event store.
 */
export interface DestructiveActionObserver {
    onSecurityEvent?(event: DestructiveSecurityEvent): void;
}
export type DestructiveSecurityEvent = {
    kind: "destructive_action_revision_created";
    requestId: string;
    revision: number;
    correlationId: string;
} | {
    kind: "destructive_action_approvals_invalidated";
    requestId: string;
    previousRevision: number;
    correlationId: string;
} | {
    kind: "destructive_action_approver_no_longer_authorized";
    requestId: string;
    operatorId: string;
    correlationId: string;
    reason: string;
} | {
    kind: "destructive_action_policy_drift_detected";
    requestId: string;
    correlationId: string;
    stricter: boolean;
} | {
    kind: "destructive_action_reapproval_required";
    requestId: string;
    correlationId: string;
    reason: string;
} | {
    kind: "destructive_action_mfa_required";
    requestId: string;
    correlationId: string;
} | {
    kind: "destructive_action_reauthentication_required";
    requestId: string;
    correlationId: string;
} | {
    kind: "destructive_action_execution_revalidated";
    requestId: string;
    correlationId: string;
} | {
    kind: "destructive_action_execution_blocked";
    requestId: string;
    correlationId: string;
    reason: string;
};
export declare class DestructiveActionService {
    private readonly engine;
    private readonly approvals;
    private readonly repo;
    private readonly approverResolver?;
    private readonly observer?;
    constructor(engine: SecurityPolicyEngine, approvals?: ApprovalSystem, repo?: Repository<DestructiveActionRequest>, approverResolver?: DestructiveApproverResolver | undefined, observer?: DestructiveActionObserver | undefined);
    request(principal: OperatorPrincipal, draft: DestructiveActionRequestDraft, correlationId: string): DestructiveActionRequest;
    revise(principal: OperatorPrincipal, requestId: string, update: DestructiveActionRequestRevision): DestructiveActionRequest;
    decide(principal: OperatorPrincipal, requestId: string, decision: DestructiveApprovalDecision, notes?: string): DestructiveActionRequest;
    assertApproved(input: AssertApprovedInput): DestructiveActionRequest;
    markExecuted(requestId: string, actorId: string, executionEvidence: Readonly<Record<string, unknown>>): DestructiveActionRequest;
    markFailed(requestId: string, actorId: string, reason: string): DestructiveActionRequest;
    cancel(principal: OperatorPrincipal, requestId: string, reason: string): DestructiveActionRequest;
    get(id: string): DestructiveActionRequest | undefined;
    list(): DestructiveActionRequest[];
    listForApproval(principal: OperatorPrincipal): DestructiveActionRequest[];
    private require;
    private transition;
    private evaluatePolicy;
    private bindingMetadata;
    private validateApprovalBinding;
    private validateMfaEvidence;
    private validateReauthEvidence;
    private emitBlock;
}
/**
 * Thin top-level helper mirroring the API in the spec. Delegates to
 * the service's TOCTOU revalidation so executors can be oblivious to
 * the service wiring.
 */
export declare function assertDestructiveActionApproved(service: DestructiveActionService, input: AssertApprovedInput): DestructiveActionRequest;
export type { Approval };
