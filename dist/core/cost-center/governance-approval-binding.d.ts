/**
 * EO-6.3 — governance's own bound-action namespace on the EXISTING
 * `ApprovalSystem` (not a second approval subsystem). Mirrors
 * `core/release/approval-binding.ts` exactly: an approval authorizes ONE
 * exact `(action, projectId, requestId)` triple; a stale, wrong-project or
 * wrong-request approval authorizes nothing.
 */
import { type Approval, type GovernanceApprovalBinding } from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
export declare function requestGovernanceApproval(approvals: Pick<ApprovalSystem, "request">, binding: GovernanceApprovalBinding, requestedBy: string, reason: string): Approval;
/** `undefined` = the approval authorizes exactly this binding, right now. */
export declare function checkGovernanceApproval(approvals: Pick<ApprovalSystem, "get">, approvalId: string | undefined, binding: GovernanceApprovalBinding, now: string): string | undefined;
