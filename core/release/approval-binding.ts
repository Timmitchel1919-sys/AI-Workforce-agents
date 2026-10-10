/**
 * EO-4.6 approval binding. REVIEW ≠ APPROVAL: an approval authorizes ONE
 * protected action on ONE exact subject. The binding travels in the
 * approval's metadata when it is requested; an approval whose binding does
 * not match exactly (other project, source, commit, branch, target or
 * operation) authorizes nothing — so stale approvals never carry over.
 */
import {
  ValidationError,
  type Approval,
  type ExecutionReason,
} from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";

export type ReleaseApprovalAction =
  "release.commit" | "release.push" | "release.deploy" | "release.rollback";

export interface ApprovalBinding {
  action: ReleaseApprovalAction;
  projectId: string;
  /** Stage set / commit receipt / candidate / release id. */
  subjectId: string;
  sourceFingerprint?: string;
  commitSha?: string;
  branch?: string;
  targetId?: string;
}

const canonical = (b: ApprovalBinding) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(b)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [z]) => a.localeCompare(z)),
    ),
  );

/** Create a PENDING approval bound to exactly this action + subject. */
export function requestBoundApproval(
  approvals: Pick<ApprovalSystem, "request">,
  binding: ApprovalBinding,
  requestedBy: string,
  reason: string,
): Approval {
  if (
    typeof reason !== "string" ||
    reason.trim() === "" ||
    reason.length > 500
  ) {
    throw new ValidationError("a reason (1-500 characters) is required");
  }
  return approvals.request({
    action: binding.action,
    requestedBy,
    reason,
    metadata: { binding: canonical(binding), projectId: binding.projectId },
  });
}

/** undefined = the approval authorizes exactly this binding. */
export function checkBoundApproval(
  approvals: Pick<ApprovalSystem, "get">,
  approvalId: string | undefined,
  binding: ApprovalBinding,
  now: string,
): ExecutionReason | undefined {
  if (!approvalId) {
    return {
      code: "APPROVAL_REQUIRED",
      detail: `${binding.action} requires an approval`,
    };
  }
  const approval = approvals.get(approvalId);
  if (!approval || approval.action !== binding.action) {
    return {
      code: "APPROVAL_REQUIRED",
      detail: "the approval does not exist for this action",
    };
  }
  if (approval.status !== "approved") {
    return {
      code: "APPROVAL_REQUIRED",
      detail: `the approval is ${approval.status}`,
    };
  }
  if (approval.expiresAt && approval.expiresAt <= now) {
    return { code: "APPROVAL_REQUIRED", detail: "the approval has expired" };
  }
  if (approval.decisionMetadata.binding !== canonical(binding)) {
    return {
      code: "APPROVAL_REQUIRED",
      detail: "the approval is bound to a different subject or source (stale)",
    };
  }
  return undefined;
}
