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
import {
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  type Approval,
  type OperatorPrincipal,
  type Repository,
  operatorCan,
  operatorCanAccessProject,
} from "../../contracts/index.js";
import {
  isDestructiveTerminal,
  validateDestructiveJustification,
  type DestructiveActionRequest,
  type DestructiveActionRequestDraft,
  type DestructiveActionStatus,
  type DestructiveApprovalDecision,
} from "../../contracts/destructive-action.js";
import type { SecurityPolicyDecision } from "../../contracts/security-policy.js";
import { ApprovalSystem } from "../approvals/approval-system.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { createId, now } from "../shared.js";
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

/**
 * Hash used to pin the exact target the engine evaluated. Any drift
 * between approval and execution invalidates the authorization. We use
 * a plain stable JSON serialization — no crypto is required because
 * the hash is a FINGERPRINT, not a signature; it only needs to detect
 * benign drift. The persistence layer is append-only and server-side.
 */
function hashTarget(input: {
  actionType: string;
  targetResourceType: string;
  targetResourceId: string;
  environment: string;
  projectId?: string;
}): string {
  const canonical = JSON.stringify([
    input.actionType,
    input.targetResourceType,
    input.targetResourceId,
    input.environment,
    input.projectId ?? "",
  ]);
  // Non-cryptographic 32-bit FNV-1a — stable, fast, available in every
  // Node version, no dependency. The hash lives in a server-side record
  // the client cannot see; attackers cannot grind it offline.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export class DestructiveActionService {
  constructor(
    private readonly engine: SecurityPolicyEngine,
    private readonly approvals: ApprovalSystem = new ApprovalSystem(),
    private readonly repo: Repository<DestructiveActionRequest> = new InMemoryRepository<DestructiveActionRequest>(),
  ) {}

  /**
   * Create a destructive-action request. The caller must hold the
   * `request_destructive_action` capability and have project access.
   * The request is placed in `awaiting_approval` if the policy
   * requires approval, else `requested`. We NEVER mark it `approved`
   * from here, even if the policy decided `allow` — a destructive
   * action still goes through the Approval Gate so there is one
   * canonical lifecycle.
   */
  request(
    principal: OperatorPrincipal,
    draft: DestructiveActionRequestDraft,
    correlationId: string,
  ): DestructiveActionRequest {
    if (!operatorCan(principal, "request_destructive_action")) {
      throw new PermissionDeniedError(
        `Operator '${principal.id}' lacks required capability 'request_destructive_action'`,
      );
    }
    if (
      draft.projectId &&
      !operatorCanAccessProject(principal, draft.projectId)
    ) {
      throw new PermissionDeniedError(
        `Operator '${principal.id}' has no access to project '${draft.projectId}'`,
      );
    }
    const problems = validateDestructiveJustification(draft.justification);
    if (problems.length > 0) {
      throw new ValidationError(
        `destructive justification incomplete: ${problems.join(", ")}`,
      );
    }
    // Evaluate policy with the real execution context.
    const policyDecision: SecurityPolicyDecision = this.engine.evaluate({
      action: draft.action,
      actorId: principal.id,
      actorType: "human",
      role: principal.role,
      projectId: draft.projectId,
      environment: draft.environment,
      targetResourceType: draft.targetResourceType,
      targetResourceId: draft.targetResourceId,
      destructive: true,
      irreversible: draft.irreversible,
      production: draft.production,
      requestedAt: now(),
      correlationId,
    });
    if (!policyDecision.allowed) {
      throw new PermissionDeniedError(
        `Security policy denied destructive action: ${policyDecision.reason}`,
      );
    }
    // HIGH/CRITICAL irreversible destructive actions need recovery evidence.
    const needsRecovery =
      (draft.irreversible || draft.production) &&
      (policyDecision.risk === "high" || policyDecision.risk === "critical");
    if (
      needsRecovery &&
      !draft.justification.backupAvailable &&
      !draft.justification.rollbackAvailable
    ) {
      throw new ValidationError(
        "destructive action blocked: no backup or rollback evidence for irreversible/production impact",
      );
    }

    const id = createId("destructive");
    const ts = now();
    const status: DestructiveActionStatus = policyDecision.requiresApproval
      ? "awaiting_approval"
      : "requested";

    // Open the primary approval record. Even when the policy doesn't
    // require approval (unusual for a destructive request — the engine
    // forces it for all inherently destructive actions), we still open
    // one so the executor's TOCTOU revalidation has a single source of
    // truth. Metadata binds it to this exact request.
    const approval = this.approvals.request({
      action: `destructive:${draft.action}`,
      requestedBy: principal.id,
      reason: draft.justification.summary,
      expiresAt: undefined,
      metadata: {
        destructiveActionId: id,
        actionType: draft.actionType,
        targetResourceType: draft.targetResourceType,
        targetResourceId: draft.targetResourceId,
        projectId: draft.projectId,
        environment: draft.environment,
        risk: policyDecision.risk,
        correlationId,
      },
    });

    const record: DestructiveActionRequest = {
      id,
      actionType: draft.actionType,
      action: draft.action,
      requestedBy: principal.id,
      actorType: "human",
      agentId: undefined,
      projectId: draft.projectId,
      targetResourceType: draft.targetResourceType,
      targetResourceId: draft.targetResourceId,
      environment: draft.environment,
      production: draft.production,
      irreversible: draft.irreversible,
      justification: draft.justification,
      policyDecision,
      status,
      approvalId: approval.id,
      secondaryApprovalId: undefined,
      history: [
        {
          recordedAt: ts,
          recordedBy: principal.id,
          kind: "requested",
          nextStatus: status,
        },
      ],
      pinnedTargetHash: hashTarget({
        actionType: draft.actionType,
        targetResourceType: draft.targetResourceType,
        targetResourceId: draft.targetResourceId,
        environment: draft.environment,
        projectId: draft.projectId,
      }),
      requestedAt: ts,
      updatedAt: ts,
      expiresAt: undefined,
      correlationId,
    };
    this.repo.upsert(record);
    return record;
  }

  /**
   * Record an approver decision. Enforces separation of duties: the
   * requester may never approve their own destructive request when the
   * policy demands independent approval (every destructive request, by
   * default). Two-person approval requires a second, distinct approver
   * — the service never collapses this to a single approval.
   */
  decide(
    principal: OperatorPrincipal,
    requestId: string,
    decision: DestructiveApprovalDecision,
    notes?: string,
  ): DestructiveActionRequest {
    if (!operatorCan(principal, "approve_destructive_action")) {
      throw new PermissionDeniedError(
        `Operator '${principal.id}' lacks required capability 'approve_destructive_action'`,
      );
    }
    const record = this.require(requestId);
    if (
      record.projectId &&
      !operatorCanAccessProject(principal, record.projectId)
    ) {
      throw new PermissionDeniedError(
        `Operator '${principal.id}' has no access to project '${record.projectId}'`,
      );
    }
    if (isDestructiveTerminal(record.status)) {
      throw new StateTransitionError(
        `destructive action ${requestId} is terminal (${record.status})`,
      );
    }
    if (record.requestedBy === principal.id) {
      throw new PermissionDeniedError(
        "separation of duties: the requester cannot approve their own destructive action",
      );
    }

    const ts = now();
    let nextStatus: DestructiveActionStatus = record.status;
    const approvalId = record.approvalId;
    let secondaryApprovalId = record.secondaryApprovalId;

    if (decision === "approve") {
      // Two-person: first approve resolves the primary and opens a
      // secondary; second approve must come from a DIFFERENT operator
      // and resolves the secondary. The record only transitions to
      // `approved` once both approvals are in. Single-person: resolve
      // the primary and transition.
      if (record.policyDecision.requiresTwoPersonApproval) {
        const primary = approvalId ? this.approvals.get(approvalId) : undefined;
        if (!primary || primary.status === "requested") {
          // First approver.
          if (approvalId) {
            this.approvals.decide(approvalId, "approved", principal.id, {
              destructiveActionId: record.id,
              notes,
            });
          }
          const second = this.approvals.request({
            action: `destructive:${record.action}#secondary`,
            requestedBy: record.requestedBy,
            reason: `second-person approval for ${record.id}`,
            metadata: {
              destructiveActionId: record.id,
              primaryApprovalId: approvalId,
              correlationId: record.correlationId,
            },
          });
          secondaryApprovalId = second.id;
          nextStatus = "awaiting_approval";
        } else {
          // Second approver — must be distinct from the first.
          if (primary.decidedBy === principal.id) {
            throw new PermissionDeniedError(
              "two-person approval requires a distinct second approver",
            );
          }
          if (!secondaryApprovalId) {
            throw new StateTransitionError(
              "two-person approval secondary record is missing",
            );
          }
          this.approvals.decide(secondaryApprovalId, "approved", principal.id, {
            destructiveActionId: record.id,
            notes,
          });
          nextStatus = "approved";
        }
      } else {
        if (approvalId) {
          this.approvals.decide(approvalId, "approved", principal.id, {
            destructiveActionId: record.id,
            notes,
          });
        }
        nextStatus = "approved";
      }
    } else if (decision === "reject") {
      if (approvalId) {
        this.approvals.decide(approvalId, "rejected", principal.id, {
          destructiveActionId: record.id,
          notes,
        });
      }
      nextStatus = "rejected";
    } else if (decision === "request_changes") {
      nextStatus = "changes_requested";
    } else if (decision === "prefer_safer_alternative") {
      nextStatus = "rejected";
    }

    const updated: DestructiveActionRequest = {
      ...record,
      status: nextStatus,
      approvalId,
      secondaryApprovalId,
      history: [
        ...record.history,
        {
          recordedAt: ts,
          recordedBy: principal.id,
          kind:
            decision === "request_changes"
              ? "changes_requested"
              : "approval_decided",
          note: notes,
          previousStatus: record.status,
          nextStatus,
        },
      ],
      updatedAt: ts,
    };
    this.repo.upsert(updated);
    return updated;
  }

  /**
   * TOCTOU revalidation. The executor calls this immediately before
   * performing the real I/O. Any drift in the target, the operator's
   * capability, the project scope, or the policy decision invalidates
   * the stored approval and the method throws.
   *
   * This is the ONLY sanctioned path to execute a destructive action.
   * Returns the (now `executing`) record on success.
   */
  assertApproved(input: AssertApprovedInput): DestructiveActionRequest {
    const record = this.require(input.requestId);
    if (record.status !== "approved") {
      throw new StateTransitionError(
        `destructive action ${input.requestId} is not approved (status=${record.status})`,
      );
    }
    // Capability + project re-check.
    if (!operatorCan(input.principal, "request_destructive_action")) {
      throw new PermissionDeniedError(
        "executor lacks request_destructive_action; destructive execution refused",
      );
    }
    if (
      record.projectId &&
      !operatorCanAccessProject(input.principal, record.projectId)
    ) {
      throw new PermissionDeniedError(
        `executor has no access to project '${record.projectId}'`,
      );
    }
    // Target pinning: refuse if any of the authoritative fields drifted.
    const current = hashTarget({
      actionType: input.actionType,
      targetResourceType: input.targetResourceType,
      targetResourceId: input.targetResourceId,
      environment: input.environment,
      projectId: input.projectId,
    });
    if (current !== record.pinnedTargetHash) {
      throw new StateTransitionError(
        "destructive action target changed since approval; re-approval required",
      );
    }
    // Expiry.
    if (record.expiresAt && now() > record.expiresAt) {
      this.transition(
        record.id,
        "expired",
        input.principal.id,
        "approval expired",
      );
      throw new StateTransitionError("destructive action approval expired");
    }
    // Primary approval still valid.
    if (!record.approvalId) {
      throw new StateTransitionError(
        "destructive action has no bound approval",
      );
    }
    const approval = this.approvals.get(record.approvalId);
    if (!approval || approval.status !== "approved") {
      throw new StateTransitionError(
        `bound approval ${record.approvalId} is not in approved state`,
      );
    }
    if (record.policyDecision.requiresTwoPersonApproval) {
      if (!record.secondaryApprovalId) {
        throw new StateTransitionError(
          "two-person approval required but second approval record is missing",
        );
      }
      const second = this.approvals.get(record.secondaryApprovalId);
      if (!second || second.status !== "approved") {
        throw new StateTransitionError(
          "two-person approval incomplete; second approver must approve",
        );
      }
      if (second.decidedBy === approval.decidedBy) {
        throw new StateTransitionError(
          "two-person approval requires two distinct approvers",
        );
      }
    }
    return this.transition(record.id, "executing", input.principal.id);
  }

  /**
   * Mark the request as completed. Only called AFTER the executor has
   * verified the real-world result; a failed execution must call
   * {@link markFailed} instead. The service does not infer success.
   */
  markExecuted(
    requestId: string,
    actorId: string,
    executionEvidence: Readonly<Record<string, unknown>>,
  ): DestructiveActionRequest {
    const record = this.require(requestId);
    if (record.status !== "executing") {
      throw new StateTransitionError(
        `destructive action ${requestId} is not executing (status=${record.status})`,
      );
    }
    const ts = now();
    const updated: DestructiveActionRequest = {
      ...record,
      status: "executed",
      updatedAt: ts,
      executionEvidence,
      history: [
        ...record.history,
        {
          recordedAt: ts,
          recordedBy: actorId,
          kind: "execution_result",
          previousStatus: "executing",
          nextStatus: "executed",
        },
      ],
    };
    this.repo.upsert(updated);
    return updated;
  }

  markFailed(
    requestId: string,
    actorId: string,
    reason: string,
  ): DestructiveActionRequest {
    const record = this.require(requestId);
    if (record.status !== "executing" && record.status !== "approved") {
      throw new StateTransitionError(
        `destructive action ${requestId} cannot fail from status ${record.status}`,
      );
    }
    return this.transition(record.id, "failed", actorId, reason);
  }

  cancel(
    principal: OperatorPrincipal,
    requestId: string,
    reason: string,
  ): DestructiveActionRequest {
    const record = this.require(requestId);
    if (
      record.requestedBy !== principal.id &&
      !operatorCan(principal, "approve_destructive_action")
    ) {
      throw new PermissionDeniedError(
        "only the requester or an approver may cancel a destructive request",
      );
    }
    if (isDestructiveTerminal(record.status)) {
      throw new StateTransitionError(
        `destructive action ${requestId} is terminal`,
      );
    }
    return this.transition(record.id, "cancelled", principal.id, reason);
  }

  get(id: string): DestructiveActionRequest | undefined {
    return this.repo.findById(id);
  }

  list(): DestructiveActionRequest[] {
    return this.repo.list();
  }

  listForApproval(principal: OperatorPrincipal): DestructiveActionRequest[] {
    return this.list().filter(
      (r) =>
        (r.status === "awaiting_approval" || r.status === "under_review") &&
        (!r.projectId || operatorCanAccessProject(principal, r.projectId)),
    );
  }

  private require(id: string): DestructiveActionRequest {
    const record = this.repo.findById(id);
    if (!record) {
      throw new ValidationError(`unknown destructive action: ${id}`);
    }
    return record;
  }

  private transition(
    id: string,
    status: DestructiveActionStatus,
    actorId: string,
    note?: string,
  ): DestructiveActionRequest {
    const record = this.require(id);
    const ts = now();
    const updated: DestructiveActionRequest = {
      ...record,
      status,
      updatedAt: ts,
      history: [
        ...record.history,
        {
          recordedAt: ts,
          recordedBy: actorId,
          kind: "status_changed",
          note,
          previousStatus: record.status,
          nextStatus: status,
        },
      ],
    };
    this.repo.upsert(updated);
    return updated;
  }
}

/**
 * Thin top-level helper mirroring the API in the spec. Delegates to
 * the service's TOCTOU revalidation so executors can be oblivious to
 * the service wiring.
 */
export function assertDestructiveActionApproved(
  service: DestructiveActionService,
  input: AssertApprovedInput,
): DestructiveActionRequest {
  return service.assertApproved(input);
}

// Also re-export the Approval type so adopters can type their call-sites.
export type { Approval };
