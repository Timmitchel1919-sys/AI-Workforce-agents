/**
 * EO-6.3 — governance's own bound-action namespace on the EXISTING
 * `ApprovalSystem` (not a second approval subsystem). Mirrors
 * `core/release/approval-binding.ts` exactly: an approval authorizes ONE
 * exact `(action, projectId, requestId)` triple; a stale, wrong-project or
 * wrong-request approval authorizes nothing.
 */
import {
  GOVERNANCE_APPROVAL_ACTION,
  type Approval,
  type GovernanceApprovalBinding,
} from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";

const canonical = (b: GovernanceApprovalBinding) =>
  `${b.action}\u0000${b.projectId}\u0000${b.requestId}`;

export function requestGovernanceApproval(
  approvals: Pick<ApprovalSystem, "request">,
  binding: GovernanceApprovalBinding,
  requestedBy: string,
  reason: string,
): Approval {
  return approvals.request({
    action: binding.action,
    requestedBy,
    reason,
    metadata: { binding: canonical(binding), projectId: binding.projectId },
  });
}

/** `undefined` = the approval authorizes exactly this binding, right now. */
export function checkGovernanceApproval(
  approvals: Pick<ApprovalSystem, "get">,
  approvalId: string | undefined,
  binding: GovernanceApprovalBinding,
  now: string,
): string | undefined {
  if (!approvalId) return `${GOVERNANCE_APPROVAL_ACTION} requires an approval`;
  const approval = approvals.get(approvalId);
  if (!approval || approval.action !== binding.action)
    return "the approval does not exist for this action";
  if (approval.status !== "approved")
    return `the approval is ${approval.status}`;
  if (approval.expiresAt && approval.expiresAt <= now)
    return "the approval has expired";
  if (approval.decisionMetadata.binding !== canonical(binding))
    return "the approval is bound to a different project or request (stale)";
  return undefined;
}
