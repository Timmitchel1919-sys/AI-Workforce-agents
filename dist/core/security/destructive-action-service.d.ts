/**
 * Security Foundation V1 — Layer 3
 *
 * Destructive Action Approval Gate.
 *
 * The service does NOT execute any destructive operation. It records
 * the authoritative state of a destructive request (who, what, why,
 * safer alternatives considered, recovery evidence) and enforces the
 * approval lifecycle. Executors call {@link assertDestructiveActionApproved}
 * immediately before the real I/O; the method revalidates every
 * precondition (TOCTOU) and refuses if any evidence changed between
 * approval and execution.
 */
import { type Approval, type OperatorPrincipal, type Repository } from "../../contracts/index.js";
import { type DestructiveActionRequest, type DestructiveActionRequestDraft, type DestructiveApprovalDecision } from "../../contracts/destructive-action.js";
import { ApprovalSystem } from "../approvals/approval-system.js";
import type { SecurityPolicyEngine } from "./security-policy-engine.js";
export interface AssertApprovedInput {
    requestId: string;
    principal: OperatorPrincipal;
    actionType: string;
    targetResourceType: string;
    targetResourceId: string;
    environment: "local" | "test" | "staging" | "production";
    projectId?: string;
}
export declare class DestructiveActionService {
    private readonly engine;
    private readonly approvals;
    private readonly repo;
    constructor(engine: SecurityPolicyEngine, approvals?: ApprovalSystem, repo?: Repository<DestructiveActionRequest>);
    /**
     * Create a destructive-action request. The caller must hold the
     * `request_destructive_action` capability and have project access.
     * The request is placed in `awaiting_approval` if the policy
     * requires approval, else `requested`. We NEVER mark it `approved`
     * from here, even if the policy decided `allow` — a destructive
     * action still goes through the Approval Gate so there is one
     * canonical lifecycle.
     */
    request(principal: OperatorPrincipal, draft: DestructiveActionRequestDraft, correlationId: string): DestructiveActionRequest;
    /**
     * Record an approver decision. Enforces separation of duties: the
     * requester may never approve their own destructive request when the
     * policy demands independent approval (every destructive request, by
     * default). Two-person approval requires a second, distinct approver
     * — the service never collapses this to a single approval.
     */
    decide(principal: OperatorPrincipal, requestId: string, decision: DestructiveApprovalDecision, notes?: string): DestructiveActionRequest;
    /**
     * TOCTOU revalidation. The executor calls this immediately before
     * performing the real I/O. Any drift in the target, the operator's
     * capability, the project scope, or the policy decision invalidates
     * the stored approval and the method throws.
     *
     * This is the ONLY sanctioned path to execute a destructive action.
     * Returns the (now `executing`) record on success.
     */
    assertApproved(input: AssertApprovedInput): DestructiveActionRequest;
    /**
     * Mark the request as completed. Only called AFTER the executor has
     * verified the real-world result; a failed execution must call
     * {@link markFailed} instead. The service does not infer success.
     */
    markExecuted(requestId: string, actorId: string, executionEvidence: Readonly<Record<string, unknown>>): DestructiveActionRequest;
    markFailed(requestId: string, actorId: string, reason: string): DestructiveActionRequest;
    cancel(principal: OperatorPrincipal, requestId: string, reason: string): DestructiveActionRequest;
    get(id: string): DestructiveActionRequest | undefined;
    list(): DestructiveActionRequest[];
    listForApproval(principal: OperatorPrincipal): DestructiveActionRequest[];
    private require;
    private transition;
}
/**
 * Thin top-level helper mirroring the API in the spec. Delegates to
 * the service's TOCTOU revalidation so executors can be oblivious to
 * the service wiring.
 */
export declare function assertDestructiveActionApproved(service: DestructiveActionService, input: AssertApprovedInput): DestructiveActionRequest;
export type { Approval };
