/**
 * Security Foundation V1 — Layer 3 (hardened)
 *
 * Destructive Action Approval Gate.
 *
 * The service does NOT execute any destructive operation. It records
 * the authoritative state of a destructive request and enforces every
 * precondition at execution time (TOCTOU). Executors call
 * {@link assertDestructiveActionApproved}; the method revalidates
 * capability, project scope, revision, target fingerprint, current
 * security policy, every historical approver, MFA/reauth freshness and
 * recovery evidence before transitioning the record to `executing`.
 */
import { createHash } from "node:crypto";
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
  SECURITY_EVIDENCE_FRESHNESS,
  isDestructiveTerminal,
  validateDestructiveJustification,
  MATERIAL_JUSTIFICATION_FIELDS,
  MATERIAL_REQUEST_FIELDS,
  type DestructiveActionJustification,
  type DestructiveActionRequest,
  type DestructiveActionRequestDraft,
  type DestructiveActionRequestRevision,
  type DestructiveActionStatus,
  type DestructiveApprovalDecision,
  type RevisionApprovalEntry,
  type SecurityMfaEvidence,
  type SecurityReauthenticationEvidence,
} from "../../contracts/destructive-action.js";
import {
  compareRisk,
  maxRisk,
  type SecurityActionContext,
  type SecurityPolicyDecision,
  type SecurityRiskLevel,
} from "../../contracts/security-policy.js";
import { ApprovalSystem } from "../approvals/approval-system.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { createId, now } from "../shared.js";
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
  /**
   * Optional request-scoped fresh approver resolver. Overrides the service-level
   * resolver for this execution.
   */
  approverResolver?: DestructiveApproverResolver;
}

/* ------------------------------------------------------------------ */
/* Canonical hashing — SHA-256 over deterministic serializations.      */
/* ------------------------------------------------------------------ */

function canonicalize(value: unknown): string {
  // Stable JSON: sort object keys, preserve array order, treat
  // undefined as absent, coerce bigint to string. This is deliberately
  // stricter than `JSON.stringify(..., Object.keys(x).sort())` because
  // nested objects need recursive key ordering.
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

/**
 * Target fingerprint. Covers the full material-identity tuple PLUS
 * `revision`, so an approval bound to revision 1 cannot authorize
 * revision 2 even if every other field happened to match.
 */
export function computeTargetFingerprint(input: {
  action: string;
  actionType: string;
  targetResourceType: string;
  targetResourceId: string;
  environment: string;
  projectId?: string;
  production: boolean;
  irreversible: boolean;
  revision: number;
}): string {
  return sha256Hex({
    action: input.action,
    actionType: input.actionType,
    targetResourceType: input.targetResourceType,
    targetResourceId: input.targetResourceId,
    environment: input.environment,
    projectId: input.projectId ?? "",
    production: input.production,
    irreversible: input.irreversible,
    revision: input.revision,
  });
}

/**
 * Policy fingerprint. Captures the EFFECT-level shape of the decision
 * (allowed / risk / requirements / matched ids), not the surrounding
 * reason text. Two decisions with the same fingerprint are "materially
 * equivalent" even if their internal reason strings differ.
 */
export function computePolicyFingerprint(
  decision: SecurityPolicyDecision,
): string {
  return sha256Hex({
    action: decision.action,
    allowed: decision.allowed,
    risk: decision.risk,
    requiresApproval: decision.requiresApproval,
    requiresReauthentication: decision.requiresReauthentication,
    requiresMfa: decision.requiresMfa,
    requiresTwoPersonApproval: decision.requiresTwoPersonApproval,
    matchedPolicyIds: [...decision.matchedPolicyIds].sort(),
  });
}

/* ------------------------------------------------------------------ */
/* Material-change detection                                            */
/* ------------------------------------------------------------------ */

function justificationMaterialChanged(
  prev: DestructiveActionJustification,
  next: DestructiveActionJustification,
): boolean {
  for (const field of MATERIAL_JUSTIFICATION_FIELDS) {
    if (canonicalize(prev[field]) !== canonicalize(next[field])) return true;
  }
  return false;
}

function requestMaterialChanged(
  prev: DestructiveActionRequest,
  next: DestructiveActionRequestRevision,
): boolean {
  for (const field of MATERIAL_REQUEST_FIELDS) {
    if (
      field in next &&
      canonicalize(
        (next as Record<string, unknown>)[field as string] ??
          (prev as unknown as Record<string, unknown>)[field as string],
      ) !==
        canonicalize(
          (prev as unknown as Record<string, unknown>)[field as string],
        )
    ) {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Strongest-requirement-wins merge                                     */
/* ------------------------------------------------------------------ */

/**
 * Combine two policy decisions so the strongest requirement in either
 * one carries. Used at execution time to prevent a WEAKENED current
 * policy from silently removing requirements that applied when the
 * approvers decided. A STRICTER current policy is handled separately
 * (we re-require reapproval under those).
 */
export function strongestOf(
  a: SecurityPolicyDecision,
  b: SecurityPolicyDecision,
): SecurityPolicyDecision {
  return {
    allowed: a.allowed && b.allowed,
    action: a.action,
    risk: maxRisk(a.risk, b.risk),
    requiresApproval: a.requiresApproval || b.requiresApproval,
    requiresReauthentication:
      a.requiresReauthentication || b.requiresReauthentication,
    requiresMfa: a.requiresMfa || b.requiresMfa,
    requiresTwoPersonApproval:
      a.requiresTwoPersonApproval || b.requiresTwoPersonApproval,
    reason: `strongest-wins(${a.reason}; ${b.reason})`,
    matchedPolicyIds: [
      ...new Set([...a.matchedPolicyIds, ...b.matchedPolicyIds]),
    ],
    recommendedAlternative:
      a.recommendedAlternative ?? b.recommendedAlternative,
  };
}

/**
 * Returns true iff `current` is materially STRICTER than `approved`
 * (new risk tier higher, newly requires approval / MFA / reauth /
 * two-person, or newly disallowed). We then force reapproval instead
 * of merging silently.
 */
export function policyIsStricter(
  approved: SecurityPolicyDecision,
  current: SecurityPolicyDecision,
): boolean {
  if (approved.allowed && !current.allowed) return true;
  if (compareRisk(current.risk, approved.risk) > 0) return true;
  if (!approved.requiresApproval && current.requiresApproval) return true;
  if (!approved.requiresMfa && current.requiresMfa) return true;
  if (!approved.requiresReauthentication && current.requiresReauthentication) {
    return true;
  }
  if (
    !approved.requiresTwoPersonApproval &&
    current.requiresTwoPersonApproval
  ) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Service                                                              */
/* ------------------------------------------------------------------ */

/**
 * Observer hook so the composition root can emit canonical security
 * events for drift / block decisions without this file depending on
 * the canonical event store.
 */
export interface DestructiveActionObserver {
  onSecurityEvent?(event: DestructiveSecurityEvent): void;
}

export type DestructiveSecurityEvent =
  | {
      kind: "destructive_action_revision_created";
      requestId: string;
      revision: number;
      correlationId: string;
    }
  | {
      kind: "destructive_action_approvals_invalidated";
      requestId: string;
      previousRevision: number;
      correlationId: string;
    }
  | {
      kind: "destructive_action_approver_no_longer_authorized";
      requestId: string;
      operatorId: string;
      correlationId: string;
      reason: string;
    }
  | {
      kind: "destructive_action_policy_drift_detected";
      requestId: string;
      correlationId: string;
      stricter: boolean;
    }
  | {
      kind: "destructive_action_reapproval_required";
      requestId: string;
      correlationId: string;
      reason: string;
    }
  | {
      kind: "destructive_action_mfa_required";
      requestId: string;
      correlationId: string;
    }
  | {
      kind: "destructive_action_reauthentication_required";
      requestId: string;
      correlationId: string;
    }
  | {
      kind: "destructive_action_execution_revalidated";
      requestId: string;
      correlationId: string;
    }
  | {
      kind: "destructive_action_execution_blocked";
      requestId: string;
      correlationId: string;
      reason: string;
    };

export class DestructiveActionService {
  /**
   * `approverResolver` is typed as optional only so that isolated unit
   * tests that never reach `assertApproved(...)` can construct the
   * service without wiring the authoritative access-control source.
   * `assertApproved(...)` itself FAILS CLOSED when the resolver is
   * missing — historical `Approval.decidedBy` metadata is NEVER
   * accepted as proof of current authorization.
   */
  constructor(
    private readonly engine: SecurityPolicyEngine,
    private readonly approvals: ApprovalSystem = new ApprovalSystem(),
    private readonly repo: Repository<DestructiveActionRequest> = new InMemoryRepository<DestructiveActionRequest>(),
    private readonly approverResolver?: DestructiveApproverResolver,
    private readonly observer?: DestructiveActionObserver,
  ) {}

  /* ---------------------------------------------------------------- */
  /* request                                                           */
  /* ---------------------------------------------------------------- */

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

    const policyDecision = this.evaluatePolicy(
      principal,
      {
        action: draft.action,
        actorType: "human",
        role: principal.role,
        projectId: draft.projectId,
        environment: draft.environment,
        targetResourceType: draft.targetResourceType,
        targetResourceId: draft.targetResourceId,
        irreversible: draft.irreversible,
        production: draft.production,
      },
      correlationId,
    );
    if (!policyDecision.allowed) {
      throw new PermissionDeniedError(
        `Security policy denied destructive action: ${policyDecision.reason}`,
      );
    }
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
    const revision = 1;
    const status: DestructiveActionStatus = policyDecision.requiresApproval
      ? "awaiting_approval"
      : "requested";

    const bindingMetadata = this.bindingMetadata({
      destructiveActionId: id,
      revision,
      action: draft.action,
      actionType: draft.actionType,
      projectId: draft.projectId,
      targetResourceType: draft.targetResourceType,
      targetResourceId: draft.targetResourceId,
      environment: draft.environment,
      production: draft.production,
      irreversible: draft.irreversible,
      risk: policyDecision.risk,
      requesterId: principal.id,
      policyFingerprint: computePolicyFingerprint(policyDecision),
      correlationId,
    });
    const approval = this.approvals.request({
      action: `destructive:${draft.action}`,
      requestedBy: principal.id,
      reason: draft.justification.summary,
      metadata: { ...bindingMetadata, role: "primary" },
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
      revision,
      approvalId: approval.id,
      secondaryApprovalId: undefined,
      approvalHistory: [
        {
          revision,
          primaryApprovalId: approval.id,
          secondaryApprovalId: undefined,
        },
      ],
      history: [
        {
          recordedAt: ts,
          recordedBy: principal.id,
          kind: "requested",
          nextStatus: status,
        },
      ],
      pinnedTargetHash: computeTargetFingerprint({
        action: draft.action,
        actionType: draft.actionType,
        targetResourceType: draft.targetResourceType,
        targetResourceId: draft.targetResourceId,
        environment: draft.environment,
        projectId: draft.projectId,
        production: draft.production,
        irreversible: draft.irreversible,
        revision,
      }),
      pinnedPolicyFingerprint: computePolicyFingerprint(policyDecision),
      requestedAt: ts,
      updatedAt: ts,
      expiresAt: undefined,
      correlationId,
    };
    this.repo.upsert(record);
    return record;
  }

  /* ---------------------------------------------------------------- */
  /* revise (new): material change → bump revision, invalidate approvals */
  /* ---------------------------------------------------------------- */

  revise(
    principal: OperatorPrincipal,
    requestId: string,
    update: DestructiveActionRequestRevision,
  ): DestructiveActionRequest {
    const record = this.require(requestId);
    if (
      record.requestedBy !== principal.id &&
      !operatorCan(principal, "approve_destructive_action")
    ) {
      throw new PermissionDeniedError(
        "only the requester or an authorized approver may revise a destructive request",
      );
    }
    if (isDestructiveTerminal(record.status)) {
      throw new StateTransitionError(
        `destructive action ${requestId} is terminal (${record.status})`,
      );
    }
    const nextJust = update.justification ?? record.justification;
    const problems = validateDestructiveJustification(nextJust);
    if (problems.length > 0) {
      throw new ValidationError(
        `destructive justification incomplete: ${problems.join(", ")}`,
      );
    }
    const requestChanged = requestMaterialChanged(record, update);
    const justChanged =
      update.justification !== undefined &&
      justificationMaterialChanged(record.justification, nextJust);
    if (!requestChanged && !justChanged) {
      // No material change — write-through, but keep revision and approvals.
      const unchanged: DestructiveActionRequest = {
        ...record,
        justification: nextJust,
        updatedAt: now(),
      };
      this.repo.upsert(unchanged);
      return unchanged;
    }

    // Re-evaluate the policy against the updated context.
    const nextAction = update.action ?? record.action;
    const nextActionType = update.actionType ?? record.actionType;
    const nextProjectId =
      "projectId" in update ? update.projectId : record.projectId;
    const nextTargetType =
      update.targetResourceType ?? record.targetResourceType;
    const nextTargetId = update.targetResourceId ?? record.targetResourceId;
    const nextEnvironment = update.environment ?? record.environment;
    const nextProduction = update.production ?? record.production;
    const nextIrreversible = update.irreversible ?? record.irreversible;

    const newDecision = this.evaluatePolicy(
      principal,
      {
        action: nextAction,
        actorType: "human",
        role: principal.role,
        projectId: nextProjectId,
        environment: nextEnvironment,
        targetResourceType: nextTargetType,
        targetResourceId: nextTargetId,
        irreversible: nextIrreversible,
        production: nextProduction,
      },
      record.correlationId,
    );
    if (!newDecision.allowed) {
      throw new PermissionDeniedError(
        `Security policy denied revised destructive action: ${newDecision.reason}`,
      );
    }

    const previousRevision = record.revision;
    const revision = previousRevision + 1;
    const ts = now();

    // Mark the previous revision's approval entry as invalidated. The
    // row stays in `approvalHistory` for audit; it just no longer
    // counts toward execution authorization under the new revision.
    const invalidated: RevisionApprovalEntry[] = record.approvalHistory.map(
      (e) =>
        e.revision === previousRevision
          ? {
              ...e,
              invalidatedAt: ts,
              invalidatedReason: "material_change_bumped_revision",
            }
          : e,
    );

    // Open a fresh primary approval record for the new revision. The
    // old primary approval remains in the Approval store as audit
    // (whatever decision it carried) — but the executor only trusts
    // `approvalHistory[revision===current].{primary,secondary}`.
    const bindingMetadata = this.bindingMetadata({
      destructiveActionId: record.id,
      revision,
      action: nextAction,
      actionType: nextActionType,
      projectId: nextProjectId,
      targetResourceType: nextTargetType,
      targetResourceId: nextTargetId,
      environment: nextEnvironment,
      production: nextProduction,
      irreversible: nextIrreversible,
      risk: newDecision.risk,
      requesterId: record.requestedBy,
      policyFingerprint: computePolicyFingerprint(newDecision),
      correlationId: record.correlationId,
    });
    const freshApproval = this.approvals.request({
      action: `destructive:${nextAction}`,
      requestedBy: record.requestedBy,
      reason: nextJust.summary,
      metadata: { ...bindingMetadata, role: "primary" },
    });

    const updated: DestructiveActionRequest = {
      ...record,
      action: nextAction,
      actionType: nextActionType,
      projectId: nextProjectId,
      targetResourceType: nextTargetType,
      targetResourceId: nextTargetId,
      environment: nextEnvironment,
      production: nextProduction,
      irreversible: nextIrreversible,
      justification: nextJust,
      policyDecision: newDecision,
      status: "awaiting_approval",
      revision,
      approvalId: freshApproval.id,
      secondaryApprovalId: undefined,
      approvalHistory: [
        ...invalidated,
        {
          revision,
          primaryApprovalId: freshApproval.id,
          secondaryApprovalId: undefined,
        },
      ],
      history: [
        ...record.history,
        {
          recordedAt: ts,
          recordedBy: principal.id,
          kind: "justification_updated",
          previousStatus: record.status,
          nextStatus: "awaiting_approval",
          note: `revision ${previousRevision} → ${revision}`,
        },
      ],
      pinnedTargetHash: computeTargetFingerprint({
        action: nextAction,
        actionType: nextActionType,
        targetResourceType: nextTargetType,
        targetResourceId: nextTargetId,
        environment: nextEnvironment,
        projectId: nextProjectId,
        production: nextProduction,
        irreversible: nextIrreversible,
        revision,
      }),
      pinnedPolicyFingerprint: computePolicyFingerprint(newDecision),
      updatedAt: ts,
    };
    this.repo.upsert(updated);
    this.observer?.onSecurityEvent?.({
      kind: "destructive_action_revision_created",
      requestId: updated.id,
      revision,
      correlationId: updated.correlationId,
    });
    this.observer?.onSecurityEvent?.({
      kind: "destructive_action_approvals_invalidated",
      requestId: updated.id,
      previousRevision,
      correlationId: updated.correlationId,
    });
    return updated;
  }

  /* ---------------------------------------------------------------- */
  /* decide                                                             */
  /* ---------------------------------------------------------------- */

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
      if (record.policyDecision.requiresTwoPersonApproval) {
        const primary = approvalId ? this.approvals.get(approvalId) : undefined;
        if (!primary || primary.status === "requested") {
          if (approvalId) {
            this.approvals.decide(approvalId, "approved", principal.id, {
              destructiveActionId: record.id,
              revision: record.revision,
              notes,
            });
          }
          const secondBinding = this.bindingMetadata({
            destructiveActionId: record.id,
            revision: record.revision,
            action: record.action,
            actionType: record.actionType,
            projectId: record.projectId,
            targetResourceType: record.targetResourceType,
            targetResourceId: record.targetResourceId,
            environment: record.environment,
            production: record.production,
            irreversible: record.irreversible,
            risk: record.policyDecision.risk,
            requesterId: record.requestedBy,
            policyFingerprint: record.pinnedPolicyFingerprint,
            correlationId: record.correlationId,
          });
          const second = this.approvals.request({
            action: `destructive:${record.action}#secondary`,
            requestedBy: record.requestedBy,
            reason: `second-person approval for ${record.id}`,
            metadata: {
              ...secondBinding,
              role: "secondary",
              primaryApprovalId: approvalId,
            },
          });
          secondaryApprovalId = second.id;
          nextStatus = "awaiting_approval";
        } else {
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
            revision: record.revision,
            notes,
          });
          nextStatus = "approved";
        }
      } else {
        if (approvalId) {
          this.approvals.decide(approvalId, "approved", principal.id, {
            destructiveActionId: record.id,
            revision: record.revision,
            notes,
          });
        }
        nextStatus = "approved";
      }
    } else if (decision === "reject") {
      if (approvalId) {
        this.approvals.decide(approvalId, "rejected", principal.id, {
          destructiveActionId: record.id,
          revision: record.revision,
          notes,
        });
      }
      nextStatus = "rejected";
    } else if (decision === "request_changes") {
      nextStatus = "changes_requested";
    } else if (decision === "prefer_safer_alternative") {
      nextStatus = "rejected";
    }

    // Keep the per-revision register in sync with the live approval ids.
    const approvalHistory: RevisionApprovalEntry[] = record.approvalHistory.map(
      (e) =>
        e.revision === record.revision
          ? {
              ...e,
              primaryApprovalId: approvalId,
              secondaryApprovalId,
            }
          : e,
    );

    const updated: DestructiveActionRequest = {
      ...record,
      status: nextStatus,
      approvalId,
      secondaryApprovalId,
      approvalHistory,
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

  /* ---------------------------------------------------------------- */
  /* assertApproved — the hardened TOCTOU execution guard               */
  /* ---------------------------------------------------------------- */

  assertApproved(input: AssertApprovedInput): DestructiveActionRequest {
    const record = this.require(input.requestId);

    // 1. status
    if (record.status !== "approved") {
      this.emitBlock(record, `not approved (status=${record.status})`);
      throw new StateTransitionError(
        `destructive action ${input.requestId} is not approved (status=${record.status})`,
      );
    }

    // 2. request expiry
    if (record.expiresAt && now() > record.expiresAt) {
      this.transition(
        record.id,
        "expired",
        input.principal.id,
        "request expired",
      );
      this.emitBlock(record, "request expired");
      throw new StateTransitionError("destructive action request expired");
    }

    // 3. executor capability
    if (!operatorCan(input.principal, "request_destructive_action")) {
      this.emitBlock(record, "executor lacks request_destructive_action");
      throw new PermissionDeniedError(
        "executor lacks request_destructive_action; destructive execution refused",
      );
    }

    // 4. executor project scope
    if (
      record.projectId &&
      !operatorCanAccessProject(input.principal, record.projectId)
    ) {
      this.emitBlock(
        record,
        `executor has no access to project ${record.projectId}`,
      );
      throw new PermissionDeniedError(
        `executor has no access to project '${record.projectId}'`,
      );
    }

    // 5. target fingerprint — includes revision.
    const currentHash = computeTargetFingerprint({
      action: record.action,
      actionType: input.actionType,
      targetResourceType: input.targetResourceType,
      targetResourceId: input.targetResourceId,
      environment: input.environment,
      projectId: input.projectId,
      production: record.production,
      irreversible: record.irreversible,
      revision: record.revision,
    });
    if (currentHash !== record.pinnedTargetHash) {
      this.emitBlock(record, "target changed since approval");
      throw new StateTransitionError(
        "destructive action target changed since approval; re-approval required",
      );
    }

    // 6. revision-bound approvals — resolve the current revision row.
    const activeRow = record.approvalHistory.find(
      (e) => e.revision === record.revision && !e.invalidatedAt,
    );
    if (!activeRow || !activeRow.primaryApprovalId) {
      this.emitBlock(record, "no active approval row for current revision");
      throw new StateTransitionError(
        "destructive action has no active approval row for current revision",
      );
    }

    // 7. current security policy re-evaluation.
    const currentDecision = this.evaluatePolicy(
      input.principal,
      {
        action: record.action,
        actorType: "human",
        role: input.principal.role,
        projectId: record.projectId,
        environment: record.environment,
        targetResourceType: record.targetResourceType,
        targetResourceId: record.targetResourceId,
        irreversible: record.irreversible,
        production: record.production,
      },
      record.correlationId,
    );
    if (!currentDecision.allowed) {
      this.observer?.onSecurityEvent?.({
        kind: "destructive_action_policy_drift_detected",
        requestId: record.id,
        correlationId: record.correlationId,
        stricter: true,
      });
      this.emitBlock(record, "current policy denies action");
      throw new PermissionDeniedError(
        `Security policy now denies action: ${currentDecision.reason}`,
      );
    }
    if (policyIsStricter(record.policyDecision, currentDecision)) {
      // Current policy is stricter than what was approved. Force reapproval.
      this.observer?.onSecurityEvent?.({
        kind: "destructive_action_policy_drift_detected",
        requestId: record.id,
        correlationId: record.correlationId,
        stricter: true,
      });
      this.observer?.onSecurityEvent?.({
        kind: "destructive_action_reapproval_required",
        requestId: record.id,
        correlationId: record.correlationId,
        reason: "current policy is materially stricter than approved policy",
      });
      this.emitBlock(
        record,
        "current policy is stricter — reapproval required",
      );
      throw new StateTransitionError(
        "current security policy is stricter than at approval; reapproval required",
      );
    }
    // Strongest-wins: a WEAKENED current policy cannot remove original
    // requirements. Merge for evidence requirements below.
    const effective = strongestOf(record.policyDecision, currentDecision);

    // 8. primary approval binding.
    const expectedPolicyFingerprint = record.pinnedPolicyFingerprint;
    const primary = this.approvals.get(activeRow.primaryApprovalId);
    this.validateApprovalBinding(
      primary,
      record,
      expectedPolicyFingerprint,
      "primary",
    );

    // 9. secondary approval binding (when required).
    let secondary: Approval | undefined;
    if (effective.requiresTwoPersonApproval) {
      if (!activeRow.secondaryApprovalId) {
        this.emitBlock(record, "two-person required but no secondary approval");
        throw new StateTransitionError(
          "two-person approval required but second approval record is missing",
        );
      }
      secondary = this.approvals.get(activeRow.secondaryApprovalId);
      this.validateApprovalBinding(
        secondary,
        record,
        expectedPolicyFingerprint,
        "secondary",
      );
    }

    // 10. approver re-resolution (active + capability + project + distinct).
    const approvers: string[] = [];
    if (primary?.decidedBy) approvers.push(primary.decidedBy);
    if (secondary?.decidedBy) approvers.push(secondary.decidedBy);
    const uniqueApprovers = Array.from(new Set(approvers));
    if (uniqueApprovers.length !== approvers.length) {
      this.emitBlock(record, "duplicate approver identities");
      throw new StateTransitionError(
        "two-person approval requires two distinct approvers",
      );
    }
    // Fail-closed: an authoritative resolver is MANDATORY. Historical
    // Approval metadata is never accepted as proof of CURRENT
    // authorization. Executing without a resolver would silently trust
    // stale `approval.decidedBy` ids and defeat Layer-3 TOCTOU.
    const resolver = input.approverResolver ?? this.approverResolver;
    if (!resolver) {
      this.emitBlock(record, "authoritative_approver_revalidation_unavailable");
      throw new StateTransitionError(
        "destructive execution blocked: authoritative approver revalidation unavailable",
      );
    }
    for (const approverId of uniqueApprovers) {
      if (approverId === record.requestedBy) {
        this.observer?.onSecurityEvent?.({
          kind: "destructive_action_approver_no_longer_authorized",
          requestId: record.id,
          operatorId: approverId,
          correlationId: record.correlationId,
          reason: "approver is also the requester",
        });
        this.emitBlock(record, "approver is the requester");
        throw new PermissionDeniedError(
          "separation of duties: the requester cannot count as an independent approver",
        );
      }
      const current = resolver.resolve(approverId);
      const invalid =
        !current ||
        !operatorCan(current, "approve_destructive_action") ||
        (record.projectId &&
          !operatorCanAccessProject(current, record.projectId));
      if (invalid) {
        this.observer?.onSecurityEvent?.({
          kind: "destructive_action_approver_no_longer_authorized",
          requestId: record.id,
          operatorId: approverId,
          correlationId: record.correlationId,
          reason: !current
            ? "approver no longer resolves as active"
            : !operatorCan(current, "approve_destructive_action")
              ? "approver no longer holds approve_destructive_action"
              : "approver no longer has access to project",
        });
        this.emitBlock(
          record,
          `approver '${approverId}' is no longer authorized`,
        );
        throw new PermissionDeniedError(
          `approver '${approverId}' is no longer an active, authorized operator; reapproval required`,
        );
      }
    }

    // 11. required-count revalidation.
    const requiredCount = effective.requiresTwoPersonApproval ? 2 : 1;
    if (uniqueApprovers.length < requiredCount) {
      this.emitBlock(
        record,
        `insufficient approvers: have ${uniqueApprovers.length} need ${requiredCount}`,
      );
      throw new StateTransitionError(
        `destructive action requires ${requiredCount} distinct approvals (have ${uniqueApprovers.length})`,
      );
    }

    // 12. MFA / reauth evidence (strongest-wins).
    if (effective.requiresMfa) {
      this.observer?.onSecurityEvent?.({
        kind: "destructive_action_mfa_required",
        requestId: record.id,
        correlationId: record.correlationId,
      });
      this.validateMfaEvidence(record, input.evidence?.mfa);
    }
    if (effective.requiresReauthentication) {
      this.observer?.onSecurityEvent?.({
        kind: "destructive_action_reauthentication_required",
        requestId: record.id,
        correlationId: record.correlationId,
      });
      this.validateReauthEvidence(record, input.evidence?.reauth);
    }

    // 13. recovery requirement revalidation.
    const needsRecovery =
      (record.irreversible || record.production) &&
      (effective.risk === "high" || effective.risk === "critical");
    if (
      needsRecovery &&
      !record.justification.backupAvailable &&
      !record.justification.rollbackAvailable
    ) {
      this.emitBlock(record, "recovery evidence missing at execution time");
      throw new StateTransitionError(
        "destructive execution blocked: recovery evidence no longer present",
      );
    }

    // 14. all checks pass — transition.
    this.observer?.onSecurityEvent?.({
      kind: "destructive_action_execution_revalidated",
      requestId: record.id,
      correlationId: record.correlationId,
    });
    return this.transition(record.id, "executing", input.principal.id);
  }

  /* ---------------------------------------------------------------- */
  /* execution outcome                                                  */
  /* ---------------------------------------------------------------- */

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

  /** Operator ids attached to the active revision's approval records. */
  currentApproverIds(requestId: string): string[] {
    const record = this.require(requestId);
    const activeRow = record.approvalHistory.find(
      (entry) => entry.revision === record.revision && !entry.invalidatedAt,
    );
    if (!activeRow) return [];
    return [activeRow.primaryApprovalId, activeRow.secondaryApprovalId]
      .filter((id): id is string => Boolean(id))
      .map((id) => this.approvals.get(id)?.decidedBy)
      .filter((id): id is string => Boolean(id));
  }

  listForApproval(principal: OperatorPrincipal): DestructiveActionRequest[] {
    return this.list().filter(
      (r) =>
        (r.status === "awaiting_approval" || r.status === "under_review") &&
        (!r.projectId || operatorCanAccessProject(principal, r.projectId)),
    );
  }

  /* ---------------------------------------------------------------- */
  /* helpers                                                            */
  /* ---------------------------------------------------------------- */

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

  private evaluatePolicy(
    principal: OperatorPrincipal,
    ctx: Omit<
      SecurityActionContext,
      "actorId" | "destructive" | "requestedAt" | "correlationId" | "metadata"
    >,
    correlationId: string,
  ): SecurityPolicyDecision {
    return this.engine.evaluate({
      ...ctx,
      actorId: principal.id,
      destructive: true,
      requestedAt: now(),
      correlationId,
    });
  }

  private bindingMetadata(input: {
    destructiveActionId: string;
    revision: number;
    action: string;
    actionType: string;
    projectId: string | undefined;
    targetResourceType: string;
    targetResourceId: string;
    environment: string;
    production: boolean;
    irreversible: boolean;
    risk: SecurityRiskLevel;
    requesterId: string;
    policyFingerprint: string;
    correlationId: string;
  }): Record<string, unknown> {
    return {
      kind: "destructive_action",
      destructiveActionId: input.destructiveActionId,
      destructiveActionRevision: input.revision,
      action: input.action,
      actionType: input.actionType,
      projectId: input.projectId,
      targetResourceType: input.targetResourceType,
      targetResourceId: input.targetResourceId,
      environment: input.environment,
      production: input.production,
      irreversible: input.irreversible,
      risk: input.risk,
      requesterId: input.requesterId,
      policyFingerprint: input.policyFingerprint,
      correlationId: input.correlationId,
    };
  }

  private validateApprovalBinding(
    approval: Approval | undefined,
    record: DestructiveActionRequest,
    expectedPolicyFingerprint: string,
    role: "primary" | "secondary",
  ): void {
    if (!approval) {
      this.emitBlock(record, `${role} approval record missing`);
      throw new StateTransitionError(
        `destructive action ${role} approval record is missing`,
      );
    }
    if (approval.status !== "approved") {
      this.emitBlock(record, `${role} approval not approved`);
      throw new StateTransitionError(
        `destructive action ${role} approval is not in approved state (status=${approval.status})`,
      );
    }
    if (approval.expiresAt && now() > approval.expiresAt) {
      this.emitBlock(record, `${role} approval expired`);
      throw new StateTransitionError(
        `destructive action ${role} approval has expired`,
      );
    }
    const meta = approval.decisionMetadata as Record<string, unknown>;
    const mismatches: string[] = [];
    const check = (field: string, expected: unknown) => {
      if (canonicalize(meta[field]) !== canonicalize(expected))
        mismatches.push(field);
    };
    check("kind", "destructive_action");
    check("destructiveActionId", record.id);
    check("destructiveActionRevision", record.revision);
    check("action", record.action);
    check("actionType", record.actionType);
    check("projectId", record.projectId);
    check("targetResourceType", record.targetResourceType);
    check("targetResourceId", record.targetResourceId);
    check("environment", record.environment);
    check("production", record.production);
    check("irreversible", record.irreversible);
    check("requesterId", record.requestedBy);
    check("policyFingerprint", expectedPolicyFingerprint);
    check("correlationId", record.correlationId);
    if (mismatches.length > 0) {
      this.emitBlock(
        record,
        `${role} approval binding mismatch on ${mismatches.join(",")}`,
      );
      throw new StateTransitionError(
        `destructive action ${role} approval binding mismatch: ${mismatches.join(", ")}`,
      );
    }
  }

  private validateMfaEvidence(
    record: DestructiveActionRequest,
    evidence: SecurityMfaEvidence | undefined,
  ): void {
    if (!evidence || !evidence.verified || !evidence.verifiedAt) {
      this.emitBlock(record, "MFA evidence missing");
      throw new PermissionDeniedError(
        "destructive execution blocked: MFA evidence is required and was not supplied",
      );
    }
    const age = Date.now() - Date.parse(evidence.verifiedAt);
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > SECURITY_EVIDENCE_FRESHNESS.mfaWindowMs
    ) {
      this.emitBlock(record, "MFA evidence stale");
      throw new PermissionDeniedError(
        "destructive execution blocked: MFA evidence is stale",
      );
    }
  }

  private validateReauthEvidence(
    record: DestructiveActionRequest,
    evidence: SecurityReauthenticationEvidence | undefined,
  ): void {
    if (!evidence || !evidence.verified || !evidence.verifiedAt) {
      this.emitBlock(record, "reauth evidence missing");
      throw new PermissionDeniedError(
        "destructive execution blocked: reauthentication evidence is required and was not supplied",
      );
    }
    const age = Date.now() - Date.parse(evidence.verifiedAt);
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > SECURITY_EVIDENCE_FRESHNESS.reauthWindowMs
    ) {
      this.emitBlock(record, "reauth evidence stale");
      throw new PermissionDeniedError(
        "destructive execution blocked: reauthentication evidence is stale",
      );
    }
  }

  private emitBlock(record: DestructiveActionRequest, reason: string): void {
    this.observer?.onSecurityEvent?.({
      kind: "destructive_action_execution_blocked",
      requestId: record.id,
      correlationId: record.correlationId,
      reason,
    });
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
